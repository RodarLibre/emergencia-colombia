# Deploying with Kamal

The site runs on a plain Debian host with Docker — today a DigitalOcean
droplet. Nothing below assumes a particular provider: Kamal connects over SSH,
so any box you can SSH into works.

The host is **not** exposed directly. Cloudflare Tunnel puts it on the
internet, and only the bot is public — see `DOMINIO-CLOUDFLARE.md`. Moving to a
different host later does not touch DNS: see `MUDANZA-DE-HOST.md`.

## 1. Prepare the host

```bash
apt update && apt install -y curl ca-certificates git
curl -fsSL https://get.docker.com | sh
docker run --rm hello-world      # verify before touching Kamal
```

Kamal connects over SSH and needs a key. From your laptop:

```bash
ssh-copy-id root@<host-ip>
ssh root@<host-ip> docker ps     # must work without a password prompt
```

### Check the network before installing anything else

The first host this project used was lost to an ISP that dropped TCP/443 to
specific destinations — Docker Hub, GitHub, the registry — while everything
else worked. It is not visible until a deploy fails in a confusing way, so rule
it out in two minutes:

```bash
for h in registry-1.docker.io registry.digitalocean.com github.com deb.debian.org; do
  printf "%-28s %s\n" "$h" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://$h/ || echo FAILS)"
done
```

All four must answer something. A timeout means the deploy will fail for
reasons that have nothing to do with this repository.

## 2. Secrets

`.kamal/secrets` is gitignored. Fill these before the first deploy:

```
POSTGRES_PASSWORD=     # generate
DATABASE_URL=          # postgres://ayuda:<password>@ayuda-terremoto-db:5432/ayuda
DO_GRADIENT_API_KEY=   # a Gradient model access key, prefix sk-do-
INGEST_SECRET=         # openssl rand -hex 32
RATE_LIMIT_SECRET=     # openssl rand -hex 32
DISCORD_WEBHOOK_URL=   # optional; empty means the usage report sends nothing
```

`RATE_LIMIT_SECRET` is not optional in production: without it the signed cookie
is never issued and the limiter falls back to network and global keys only,
which throttles a whole shelter's wifi together.

**Kamal does not read `.env`.** The host address and the non-secret settings
come from the environment, so every command is:

```bash
set -a && source .env && set +a && kamal deploy
```

## 3. Deploy

```bash
kamal setup      # first time: installs, pushes the image, starts everything
kamal deploy     # every time after
kamal app logs -f
```

`kamal setup` also starts the Postgres accessory defined in `deploy.yml`.

## 4. Prepare the database, once

**`kamal setup` does not create the schema.** Without this step the container
starts, `/salud` returns 503, and Kamal kills it without saying why.

Postgres only listens on `127.0.0.1`, so everything below goes through a tunnel:

```bash
ssh -f -N -L 55432:127.0.0.1:5432 root@<host-ip>
export PROD="postgres://ayuda:<password>@127.0.0.1:55432/ayuda"
```

First time only, when the database is empty:

```bash
DATABASE_URL="$PROD" pnpm db:push
psql "$PROD" -f src/db/indexes.sql
```

### Never run `db:push` against a database that already has data

`push` diffs the WHOLE schema. Asked to add one column to `sources`, it noticed
that `answer_feedback`'s unique constraint had been created by hand under a
different name and **offered to truncate that table** to reconcile it. During an
emergency that is not a risk worth taking for one column.

Every change after the first load ships as a statement you read in full before
applying:

```bash
psql "$PROD" -f src/db/answer-feedback.sql          # answer feedback table
psql "$PROD" -f src/db/windowed-listing.sql         # sources.windowed_listing
psql "$PROD" -f src/db/department-from-municipality.sql   # backfill, idempotent
```

They are all idempotent, so running one twice is safe, and `src/db/schema.ts`
still owns the definition — each file has to say the same thing it does.

**A deploy does not migrate anything.** New code hitting a column that does not
exist fails at runtime, and where the failure is swallowed on purpose — a vote
on an answer, for instance — it fails silently and forever. Apply the SQL
*before* the deploy that needs it.

Then delete the demo sources, or the site refuses to serve:

```sql
DELETE FROM sources WHERE slug LIKE 'demo-%';
```

That is not a formality. `/salud` returns 503 while any `demo-%` source is
enabled, the healthcheck fails, and Kamal will not promote the container.

## 5. First ingest, and the cron

**One line per connected source, and `mapa-emergencia` is the big one.** It
contributes roughly 780 of the ~900 records; leave it out and the site comes up
looking like it works, with an eighth of the catalog. Nothing detects a missing
cron line — the source stops being reconfirmed and goes stale in silence.

Confirm the current set against `ADAPTERS` in `src/ingest/registry.ts` rather
than trusting this list; `cali-ayuda` is disabled and is not scheduled.

```bash
curl -X POST "https://<domain>/api/ingest?fuente=mapa-emergencia"   -H "Authorization: Bearer $INGEST_SECRET"
curl -X POST "https://<domain>/api/ingest?fuente=donde-ayudo-valle" -H "Authorization: Bearer $INGEST_SECRET"
curl -X POST "https://<domain>/api/ingest?fuente=sgc-sismos"        -H "Authorization: Bearer $INGEST_SECRET"
```

> **Check the response before trusting the schedule.** `/api/*` answers `404`
> to any request carrying `CF-Connecting-IP`, i.e. arriving through the tunnel
> from the public internet (`src/middleware.ts`). If `<domain>` resolves out to
> Cloudflare and back, these calls get a silent `404` and ingest never runs. A
> `200` means the path is internal; a `404` means the cron has to reach the
> container directly on the host. `curl -fsS` fails loudly on 404, which is why
> the `-f` is there.

Two crons live on the host. **They are not in this repository, so a host move
loses them silently** — `MUDANZA-DE-HOST.md` §5 has both.

```cron
*/15 * * * * curl -fsS -X POST "https://<domain>/api/ingest?fuente=mapa-emergencia"   -H "Authorization: Bearer $INGEST_SECRET" >/dev/null
*/15 * * * * curl -fsS -X POST "https://<domain>/api/ingest?fuente=donde-ayudo-valle" -H "Authorization: Bearer $INGEST_SECRET" >/dev/null
*/10 * * * * curl -fsS -X POST "https://<domain>/api/ingest?fuente=sgc-sismos"        -H "Authorization: Bearer $INGEST_SECRET" >/dev/null
```

The second is the **usage report**: `/etc/cron.d/ayuda-reporte` calling
`/usr/local/bin/ayuda-reporte` hourly, which pulls the secret out of the
container so it is not stored twice. Without `DISCORD_WEBHOOK_URL` it sends
nothing and does not fail, so it is safe to schedule before the webhook exists.

## 6. Check that inference actually works

Any AI failure degrades to deterministic search and never errors — that is
invariant 9, and it means a dead provider is invisible. You have to ask:

```bash
curl -s -H "Authorization: Bearer $INGEST_SECRET" \
  "http://$DEPLOY_HOST/salud?inferencia=1"
```

`{"inferencia":{"ok":true,"estado":"ok","ms":...}}` is what you want.
`http_402` means the key authenticates but is not enabled to run models: it
needs a Gradient **model access key** (prefix `sk-do-`), not an account token
(`doo_v1_` / `dop_v1_`).

It is authenticated because every call spends money at the provider; open, it
would be a way to burn the budget in a loop. The container healthcheck uses
plain `/salud` without the parameter — a dead provider must never take the
container down, because the site works without it.

## Backups

Postgres lives in a Docker volume on the host.

```bash
docker exec ayuda-terremoto-db pg_dump -U ayuda ayuda | gzip > /var/backups/ayuda-$(date +%F).sql.gz
```

The catalog can be rebuilt from the sources at any time — the adapters are
idempotent, so a restore followed by an ingest converges. What a backup really
protects is the **observation history**: what each source said and when. That is
the part no re-ingest can recover, and the part with archival value once the
sources go offline.

## If the site has to survive a regional outage

Hosting inside the affected region means a regional power or internet failure
takes the site down at the moment it matters most. The recovery path is short
because the image is already in a registry: point `DEPLOY_HOST` at another box,
run `kamal setup`, restore the dump, and move the tunnel. Keeping a recent
`pg_dump` off-site is what makes that a ten-minute operation instead of a
rebuild. Full steps in `MUDANZA-DE-HOST.md`.
