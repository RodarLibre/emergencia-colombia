# Deploying to a Proxmox LXC with Kamal

Concrete steps for the container this project is being deployed to. The general
deployment notes are in `README.md`; this covers what is specific to LXC.

## 1. Create the container

Debian 12 or 13. Anything else adds friction with Docker's apt repository.

Resources — this workload is a Node process and a Postgres, both small:

| | Value | Why |
|---|---|---|
| Cores | 2 | Next.js build is the only spike |
| RAM | 4 GB | Postgres plus the app fits in 2; 4 leaves room to build in place |
| Swap | 512 MB | |
| Disk | 20 GB | The image is 283 MB; the rest is Docker layers and Postgres |
| Unprivileged | yes | No reason to run privileged |

## 2. The setting that actually matters

**Docker will not run in an unprivileged LXC without nesting.** This is the step
that fails confusingly if skipped — Docker installs fine and then containers
refuse to start.

On the Proxmox host, with the container stopped:

```bash
pct set <CTID> --features nesting=1,keyctl=1
```

`nesting` lets Docker create its own namespaces; `keyctl` is what Postgres needs
to initialise. Then start it and verify **before** touching Kamal:

```bash
pct start <CTID>
pct enter <CTID>
docker run --rm hello-world
```

If that prints the hello-world banner, the hard part is done. If it does not,
stop here — nothing downstream will work.

### If you also want Tailscale in the container

Same class of trap as nesting: an unprivileged LXC has no `/dev/net/tun`, so
Tailscale installs cleanly and then fails to start. On the Proxmox host, with
the container stopped, add to `/etc/pve/lxc/<CTID>.conf`:

```
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```

Then `tailscale up` works normally. (The alternative,
`tailscaled --tun=userspace-networking`, avoids the device but gives up
subnet routing.)

**Tailscale gives you and Kamal access to the box. It does not put the site on
the internet.** Deploying successfully to a Tailscale IP and stopping there
means nobody in Cali can open it — the tunnel in step 4 is what makes it
public.

## 3. Prepare the container

```bash
apt update && apt install -y curl ca-certificates git
curl -fsSL https://get.docker.com | sh
docker run --rm hello-world      # verify again after install
```

Kamal connects over SSH and needs a key. From your laptop:

```bash
ssh-copy-id root@<LXC-IP>
ssh root@<LXC-IP> docker ps      # must work without a password prompt
```

## 4. Make it reachable from the internet

An LXC on a home network is not reachable, and Tailscale is for administration,
not publication. People in Cali cannot open a Tailscale address.

**Cloudflare Tunnel** is the cleanest path: no port forwarding, works behind
CGNAT, and terminates TLS at Cloudflare.

```bash
# inside the LXC
curl -fsSL https://pkg.cloudflare.com/cloudflared-stable-linux-amd64.deb -o cloudflared.deb
dpkg -i cloudflared.deb
cloudflared tunnel login
cloudflared tunnel create ayuda-terremoto
cloudflared tunnel route dns ayuda-terremoto <your-domain>
```

Point the tunnel at the container's HTTP port, not HTTPS:

```yaml
# ~/.cloudflared/config.yml
ingress:
  - hostname: <your-domain>
    service: http://localhost:80
  - service: http_status:404
```

```bash
cloudflared service install    # run it as a service, not in a terminal
```

### One change to `config/deploy.yml` if you use a tunnel

The template requests a Let's Encrypt certificate, which needs the host to be
publicly reachable on port 443. Behind a tunnel it is not, and the certificate
request will fail. Cloudflare already terminates TLS, so:

```yaml
proxy:
  ssl: false # Cloudflare terminates TLS; kamal-proxy serves plain HTTP locally
  host: <your-domain>
  healthcheck:
    path: /salud
    interval: 5
```

Leave `ssl: true` only if you expose 443 directly with a public A record.

## 5. Deploy

```bash
# from the repo on your laptop
kamal setup      # first time: installs, pushes the image, starts everything
kamal deploy     # every time after
kamal app logs -f
```

`kamal setup` also starts the Postgres accessory defined in `deploy.yml`.

## 6. Prepare the database, once

```bash
kamal app exec --interactive "sh"
# inside the container:
#   the schema is pushed from your laptop against the production DATABASE_URL
```

Simpler in practice: point `DATABASE_URL` at the production database from your
laptop and run once:

```bash
pnpm db:push
psql "$DATABASE_URL" -f src/db/indexes.sql
```

Then **delete the demo sources**, or the site will refuse to serve:

```sql
DELETE FROM sources WHERE slug LIKE 'demo-%';
```

That is not a formality. `/salud` returns 503 while any `demo-%` source is
enabled, the healthcheck fails, and Kamal will not promote the container. The
reason is in the container logs.

## 7. First ingest and the cron

```bash
curl -X POST "https://<domain>/api/ingest?fuente=donde-ayudo-valle" -H "Authorization: Bearer $INGEST_SECRET"
curl -X POST "https://<domain>/api/ingest?fuente=cali-ayuda"        -H "Authorization: Bearer $INGEST_SECRET"
curl -X POST "https://<domain>/api/ingest?fuente=sgc-sismos"        -H "Authorization: Bearer $INGEST_SECRET"
```

Then in the LXC's crontab:

```cron
*/15 * * * * curl -fsS -X POST "https://<domain>/api/ingest?fuente=donde-ayudo-valle" -H "Authorization: Bearer $INGEST_SECRET" >/dev/null
*/20 * * * * curl -fsS -X POST "https://<domain>/api/ingest?fuente=cali-ayuda"        -H "Authorization: Bearer $INGEST_SECRET" >/dev/null
*/10 * * * * curl -fsS -X POST "https://<domain>/api/ingest?fuente=sgc-sismos"        -H "Authorization: Bearer $INGEST_SECRET" >/dev/null
```

## 8. Secrets

`.kamal/secrets` is gitignored and needs four values filled before the first
deploy:

```
POSTGRES_PASSWORD=     # generate
DATABASE_URL=          # postgres://ayuda:<password>@ayuda-terremoto-db:5432/ayuda
DO_GRADIENT_API_KEY=   # rotate the one shared during development
INGEST_SECRET=         # openssl rand -hex 32
RATE_LIMIT_SECRET=     # openssl rand -hex 32
```

`RATE_LIMIT_SECRET` is not optional in production: without it the signed cookie
is never issued and the limiter falls back to network and global keys only,
which throttles a whole shelter's wifi together.

## Backups

Postgres lives in a Docker volume inside the LXC. Two layers:

```bash
# nightly dump, kept outside the container
docker exec ayuda-terremoto-db pg_dump -U ayuda ayuda | gzip > /var/backups/ayuda-$(date +%F).sql.gz
```

Plus a Proxmox snapshot of the LXC on whatever schedule you already use.

The catalog can be rebuilt from the sources at any time — the adapters are
idempotent, so a restore followed by an ingest converges. What a backup really
protects is the **observation history**: what each source said and when. That is
the part no re-ingest can recover, and it is the part with archival value once
the sources go offline.

## If the site has to survive a regional outage

Hosting inside the affected region means a regional power or internet failure
takes the site down at the moment it matters most. If that becomes a real
concern, the recovery path is short because the image is already in a registry:

```bash
# change the server IP in config/deploy.yml, then
kamal setup
```

Point a VPS at the same domain and redeploy. Keeping a recent `pg_dump` off-site
is what makes that a ten-minute operation instead of a rebuild.
