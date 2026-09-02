# Optional: deploying to a Proxmox LXC

**This is one host option, not the way the project is deployed.** Nothing in
the application knows about Proxmox, LXC, or any provider: Kamal connects over
SSH, so any Debian box with Docker works, and `docs/DEPLOY.md` is the guide
that actually matters. Read that one first — this file only covers what an
unprivileged LXC does differently, and it exists because those differences fail
in ways that do not say what is wrong.

A previous version of this file was deleted in `437101c`, correctly: it had
grown into a full deployment guide for a host nobody had at the time, and the
host-agnostic parts became `DEPLOY.md`. What follows is deliberately only the
container-specific part, so it can be ignored by anyone deploying anywhere
else — and deleted outright the day nobody runs on LXC.

## The container

Debian 12 or 13; anything else adds friction with Docker's apt repository.

| | Verified working | Note |
|---|---|---|
| Cores | 2 | The Next.js build is the only spike: ~195 s on the first deploy, ~80 s after |
| RAM | 8 GB | Postgres plus the app fit in about 2; the rest is headroom to build in place |
| Disk | 24 GB (18 free) | The image is ~283 MB; the rest is Docker layers and Postgres |
| Unprivileged | yes | No reason to run privileged |

## The setting that actually matters

**Docker will not run in an unprivileged LXC without nesting.** It installs
fine and then containers refuse to start, which is why this is first: nothing
downstream works and the error does not point here.

On the Proxmox host, with the container stopped:

```bash
pct set <CTID> --features nesting=1,keyctl=1
```

`nesting` lets Docker create its own namespaces; `keyctl` is what Postgres
needs to initialise. Then start it and verify **before touching Kamal**:

```bash
pct start <CTID>
pct enter <CTID>
docker run --rm hello-world
```

If that prints the hello-world banner, the hard part is done. If it does not,
stop here.

That one command is also the whole check on a container somebody else set up:
`docker --version` answering proves nothing, because the failure is at runtime.

### If you also want Tailscale in the container

Same class of trap: an unprivileged LXC has no `/dev/net/tun`, so Tailscale
installs cleanly and then fails to start. On the Proxmox host, with the
container stopped, add to `/etc/pve/lxc/<CTID>.conf`:

```
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```

Then `tailscale up` works normally. The alternative,
`tailscaled --tun=userspace-networking`, avoids the device but gives up subnet
routing.

## Which address goes in `DEPLOY_HOST`

Both work, and the choice is a trade-off rather than a detail:

- **The LAN address** (`192.168.20.45`) is what the box answers on at home.
  Deploys only work from that network.
- **The Tailscale address** (`100.x.y.z`) works from anywhere you are logged
  into the tailnet, which is what `MUDANZA-DE-HOST.md` assumes.

Whichever you pick, **it has nothing to do with whether the site is public.**
Tailscale gives you and Kamal access to the box; deploying successfully to
either address and stopping there means nobody in Pereira can open the site.
Cloudflare Tunnel is what publishes it — `DOMINIO-CLOUDFLARE.md`.

A home network is also a real availability decision for an emergency site: the
origin now depends on that house having power and internet, where a datacentre
did not. Run the network check in `DEPLOY.md` §1 before committing to it — the
host before this one was lost to an ISP that dropped TCP/443 to specific
destinations while everything else worked.

## What is NOT specific to LXC

Two things that look like they belong here and do not:

- **The stale buildx builder** after moving hosts. It bites on any host change,
  and it is in `DEPLOY.md` §3.
- **The crons.** They live on the host and a move loses them, LXC or not —
  `MUDANZA-DE-HOST.md` §5.
