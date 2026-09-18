# Deploying Pickl

Docker, Portainer, NAS bind mounts, reverse proxies and storage. Part of
[Pickl](../README.md).

## Deploying with Docker / Portainer

The app builds to a Next.js **standalone** output (`output: 'standalone'`
in `next.config.js`) and ships in a small, non-root runtime image.

### Option A — build the image yourself and push, then deploy in Portainer

```bash
docker build -t your-registry/pickl:latest .
docker push your-registry/pickl:latest
```

Then create a Portainer stack using `docker-compose.yml` (edit the `image:`
line to point at your pushed image, or leave the `build:` section if
Portainer has access to this repo and can build it directly).

### Option B — point Portainer at this Git repo

In Portainer, create a new **Stack**, choose "Repository" as the build
method, point it at this repo, and use `docker-compose.yml` as the compose
file. Portainer will build the image from the included `Dockerfile`.

### Required stack environment variables

Set these via **Portainer's stack "Environment variables" editor** when
deploying — `docker-compose.yml` intentionally ships with empty
placeholders and a comment explaining this, so no real secrets are ever
committed to source control.

| Variable | Required | Description |
|---|---|---|
| `WEB_PORT` | No | Host port the app is published on. Defaults to `3000`. Set this to avoid collisions with other stacks, or to whatever your reverse proxy points at. Changing it does NOT change `NEXTAUTH_URL`/`APP_BASE_URL` — see below. |
| `APP_PORT` | No | Port the app listens on *inside* the container. Defaults to `3000`. Rarely needed — only if you attach the container directly to a proxy network and address it as `pickl:<port>`, or use `network_mode: host`. |
| `NEXTAUTH_SECRET` | Yes | Random secret for signing session JWTs. Generate one with `openssl rand -base64 32` and treat it like a password. |
| `NEXTAUTH_URL` | Yes | The public URL the app is served at, e.g. `https://dinner.yourdomain.com`. |
| `AUTH_TRUST_HOST` | Yes | Must be `true`. Auth.js refuses to serve auth requests from a host it doesn't already recognize as safe unless this is set — without it you'll see an `UntrustedHost` error on login. |
| `APP_BASE_URL` | Yes | Base URL used to build verification email links **and the Google OAuth redirect URI** (`{APP_BASE_URL}/api/calendar/google/callback`). Usually identical to `NEXTAUTH_URL`. If you use Google Calendar sync, this must match the redirect URI registered on the OAuth client in Google Cloud, or every connection attempt fails with `redirect_uri_mismatch`. |
| `DATABASE_PATH` | Yes | Path to the SQLite file inside the container. Leave as `/data/app.db` to match the volume mount in `docker-compose.yml`. |
| `SMTP_HOST` | Yes (for real email) | Your SMTP server's hostname, e.g. `smtp.gmail.com`. |
| `SMTP_PORT` | Yes | SMTP port — typically `587` (STARTTLS) or `465` (implicit TLS). |
| `SMTP_USER` | Yes | SMTP username. |
| `SMTP_PASS` | Yes | SMTP password (see Gmail note below). |
| `SMTP_FROM` | Yes | The "From" address for outgoing mail, e.g. `Pickl <no-reply@yourdomain.com>`. |

### Pulling the prebuilt image

Every push to `main` builds the image and publishes it to GitHub Container
Registry via `.github/workflows/publish-image.yml`:

```bash
docker pull ghcr.io/wallacegsr/pickl:latest
```

Available tags:

| Tag | Tracks |
| --- | --- |
| `latest` | the tip of `main` |
| `1.2.3` / `1.2` / `1` | git tags matching `v*.*.*` |
| `sha-abc1234` | one exact commit |

`docker-compose.yml` uses `:latest`. Pin a version tag instead if you would
rather upgrades be a deliberate act than whatever landed on `main`.

Built for `linux/amd64` and `linux/arm64`, so it runs on an x86 server or on
a Raspberry Pi / ARM NAS. If you only ever deploy on x86 and want faster CI,
drop `linux/arm64` and the QEMU step from the workflow — the ARM build is
emulated and is most of the build time.

> **The first publish creates a *private* package.** `docker pull` will fail
> with `denied` or `unauthorized` until you change that once, by hand:
>
> Your profile → **Packages** → `pickl` → **Package settings** →
> **Danger Zone** → **Change visibility** → **Public**.
>
> This catches everyone. A public repository does *not* imply a public
> package; the two are separate settings. You only need to do it once — later
> pushes keep whatever visibility the package already has.

While the package is private, or if you keep it private on purpose, pull with
a [personal access token](https://github.com/settings/tokens) that has the
`read:packages` scope:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u wallacegsr --password-stdin
```

**Deploying in Portainer:** point the stack at this repository (or paste the
compose file), set the environment variables listed above, and deploy. Because
the compose file references the registry image rather than a build context,
Portainer pulls it — no build tooling needed on the host. Tick **re-pull image**
when redeploying to pick up a new `:latest`.

### Bind mounts (Synology and other NAS)

The stack ships with a named volume, which Docker manages for you. To keep the
database somewhere you can see and back up — a Synology shared folder, say —
swap the volume for a bind mount:

```yaml
    volumes:
      - /volume1/docker/pickl:/data
```

Two things trip people up here, and neither produces an obvious error.

**`DATABASE_PATH` is a path *inside* the container, not on the NAS.** The mount
already maps the host directory to `/data`, so it stays exactly as it is:

```yaml
      DATABASE_PATH: "/data/app.db"     # correct
```

Setting it to the host path (`/volume1/docker/pickl/data/app.db`) points the
app at a directory that does not exist inside the container. It will try to
create it at the container root, fail, and never write to your NAS folder at
all.

**Create the directory first, and give it to uid 1001.** The container runs as
a non-root user (`nextjs`, uid 1001). The image pre-creates `/data` owned by
that user, but a bind mount replaces that with the host directory's ownership —
so if the folder is owned by root, the app cannot create its database. Over SSH
on the NAS:

```bash
sudo mkdir -p /volume1/docker/pickl
sudo chown -R 1001:1001 /volume1/docker/pickl
```

Skip this and the container starts, fails on the migration step with
`SQLITE_CANTOPEN` or `EACCES`, and restarts in a loop — Portainer shows a
restarting container rather than a useful message, so check the container logs.

You will know it worked when `app.db`, `app.db-wal` and `app.db-shm` appear in
the host directory. If they do not, the app is writing inside the container and
the data will vanish on the next redeploy.

Also quote your environment values. Compose wants strings, and a bare
`AUTH_TRUST_HOST: true` (a YAML boolean) or `PORT: 3000` (an integer) can fail
validation — in Portainer that surfaces only as an opaque
`request failed with error 500`.

### Ports and reverse proxies

The published port and the public URL are two different things, and mixing
them up is the most common way a deployment half-works.

```
        https://pickl.example.com     <-- NEXTAUTH_URL / APP_BASE_URL
                    |
             reverse proxy (nginx, Caddy, Traefik, NPM)
                    |
        http://<docker-host>:8099     <-- WEB_PORT
                    |
              container :3000         <-- APP_PORT (rarely changed)
```

- **`WEB_PORT` only affects where the container is published on the host.**
  Set it to any free port; the app itself neither knows nor cares.
- **`NEXTAUTH_URL` and `APP_BASE_URL` must be the public URL your users
  type**, *not* `http://host:WEB_PORT`. They build auth callbacks,
  verification and invite email links, and the Google OAuth redirect URI.
  Point them at the container port instead and login redirects, emailed
  links, and Google sign-in will all send people somewhere unreachable.
- **`AUTH_TRUST_HOST=true` is required** behind a proxy — Auth.js otherwise
  rejects requests whose `Host` header it did not originate.
- Forward `Host` and `X-Forwarded-Proto` from the proxy so the app sees the
  original scheme. Without `X-Forwarded-Proto: https`, cookies meant to be
  Secure may not behave as expected.
- Terminating TLS at the proxy and speaking plain HTTP to the container is
  fine and expected — `NEXTAUTH_URL` still uses `https://`.

**Not using a reverse proxy?** If you reach the app directly at
`http://<host>:8099`, set `NEXTAUTH_URL` and `APP_BASE_URL` to exactly that,
including the port.


If `SMTP_HOST` is left blank, the app will still run, but verification
emails are only written to the container logs instead of being delivered —
fine for a quick test, not for real household use.

#### Using Gmail for SMTP

Gmail requires an **App Password**, not your normal account password
(this only works if 2-Step Verification is enabled on the Google account):

1. Enable 2-Step Verification on the Google account.
2. Go to Google Account → Security → App passwords, and create one for
   "Mail" / "Other".
3. Use these values:
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=587`
   - `SMTP_USER=youraddress@gmail.com`
   - `SMTP_PASS=<the 16-character app password>`
   - `SMTP_FROM=Pickl <youraddress@gmail.com>`

Any other SMTP provider (SendGrid, Mailgun, your own mail server, etc.)
works the same way — just fill in its host/port/credentials.

### Persistent storage

The SQLite database is the only state this app has. `docker-compose.yml`
mounts a named volume (`pickl-data`) at `/data` inside the
container, and `DATABASE_PATH=/data/app.db` points the app at a file on
that volume. As long as the volume isn't deleted, your recipes and plan
survive container restarts, image rebuilds, and redeploys. Back up the
volume (or periodically copy `/data/app.db` out of the container) if you
want off-host backups.

> **Upgrading from a deployment made before the "Pickl" rename?** The named
> volume used to be called `dinner-planner-data`; it is now `pickl-data`.
> Docker Compose does **not** error on a volume name it has never seen — it
> silently creates a new, empty one — so a stack that redeploys straight
> onto the new name comes up with a **blank database** while the old volume
> sits there untouched. Either keep the old name in your compose file, or
> copy the data across before redeploying, e.g.:
>
> ```bash
> docker volume create pickl-data
> docker run --rm -v dinner-planner-data:/from -v pickl-data:/to alpine \
>   sh -c "cp -a /from/. /to/"
> ```
>
> `DATABASE_PATH` (`/data/app.db`) and the in-container mount target are
> unchanged and must stay that way — only the volume's *name* moved.

### Container startup behavior

The container's entrypoint (`scripts/start.js`) always:

1. Runs any pending database migrations (`scripts/migrate.mjs`) against
   `DATABASE_PATH`, creating the database file and directory on first run.
2. Starts the Next.js standalone server (`server.js`) on port `3000`.

The container runs as a non-root user for defense in depth.

