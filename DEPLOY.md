# Deploying

This app is two containers (API + client) wired together with Docker Compose.
It's written to run on any host that can run Docker: a VPS, Railway, Render,
Fly.io, etc.

## Prerequisites

1. A host with Docker and Docker Compose installed.
2. A domain (or subdomain) pointed at it, if you want real users to reach it.
3. **YouPI-PG deployed somewhere reachable from the internet**, if you want
   real UPI settlement to work. It's a separate project
   (https://github.com/youpi-pg/YouPI-PG) with its own deploy — this repo
   doesn't include it. Everything else in the app (expenses, balances,
   friends, recurring expenses, receipts, activity feed, email, push
   notifications, AI receipt scanning) works without it; only the "Pay via
   UPI" settlement button needs it. If you skip it, people can still
   "Mark as paid (cash)".
4. Optional, for the extra features to actually run: an SMTP account (for
   email) and an NVIDIA API key from build.nvidia.com (for AI receipt
   scanning). Both degrade gracefully (clearly disabled) if left blank.

## 1. Configure secrets

```bash
cp server/.env.example server/.env
```

Fill in `server/.env`:

- `JWT_SECRET` — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `NODE_ENV=production`
- `CLIENT_ORIGIN` — your real public app URL, e.g. `https://app.example.com`
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — generate with
  `node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"`
  (run that from inside `server/` where `web-push` is installed). Set these
  explicitly rather than leaving them blank — left blank, a keypair is
  auto-generated into the data volume on first boot, which is fine, but
  regenerating it on every redeploy would invalidate every push subscription.
- `YOUPI_API_URL` / `YOUPI_MERCHANT_ID` / `YOUPI_WEBHOOK_SECRET` /
  `YOUPI_CHECKOUT_HOST` — from your own YouPI-PG deployment's merchant-admin
  dashboard, if you're enabling real payments.
- `SMTP_*` and `NVIDIA_API_KEY` — optional, as above.

The client needs no `.env` file for a Docker build — it deliberately omits
`VITE_API_URL` so the built app calls `/api/...` relative to itself, which
nginx proxies to the `server` container. This is what keeps the session
cookie same-origin (see "Why same-origin" below) rather than fighting
cross-site cookie rules.

## 2. Build and run

```bash
docker compose build
docker compose up -d
```

Check it's healthy:

```bash
docker compose ps
curl http://localhost/api/health   # -> {"ok":true}
```

The client is now serving on port 80 of the host.

## 3. Put TLS in front of it

`docker-compose.yml` exposes the client on plain HTTP port 80. For a real
deployment, put a TLS-terminating reverse proxy in front of that — Caddy is
the least setup (automatic Let's Encrypt certs):

```caddyfile
app.example.com {
    reverse_proxy localhost:80
}
```

Or use whatever your host already provides (Railway/Render/Fly all terminate
TLS for you automatically in front of a container listening on a port).

If you're on a PaaS that expects one container to bind a single `$PORT`, you
can instead deploy `client`'s image only, pointing its nginx at a `server`
deployed separately with its own public URL — just set `VITE_API_URL` as a
build arg in that case instead of relying on the proxy, and adjust CORS on
the server (`CLIENT_ORIGIN`) accordingly. The default compose setup bundles
both into one TLS origin and avoids needing to do this.

## Data & backups

Everything stateful — the SQLite database and uploaded receipt files — lives
in the `server-data` named volume, mounted at `/app/data` in the API
container. The sqlite3 CLI isn't installed in the image, so back up the
whole volume rather than trying to run `.backup` inside the container:

```bash
docker run --rm \
  -v splitwise_clone_server-data:/data \
  -v "$PWD":/out \
  alpine tar czf /out/data-backup-$(date +%F).tgz -C / data
```

(volume name may differ — check with `docker volume ls`; compose prefixes it
with the project/folder name.) Restore by extracting that tarball back into
a fresh volume before starting the container.

## Schema changes after you've gone live

`server/src/db/index.js` keeps a `SCHEMA_VERSION` constant. In development, a
version bump just rotates the old SQLite file aside (never deletes it) and
starts fresh — convenient with no real users yet. In production
(`NODE_ENV=production`), the server now refuses to start on a mismatch instead
of doing that silently, because wiping real user data by accident on a
routine deploy would be bad. If you ever need to intentionally reset
(you don't have real users yet, or you've already migrated data out), set
`ALLOW_SCHEMA_RESET=true` for that one deploy. For a real schema change with
real data to keep, write an actual migration instead.

## Why same-origin

The server issues the session as an httpOnly cookie. If the client and API
were on two different domains (e.g. separate `*.onrender.com` subdomains),
the cookie would need `SameSite=None; Secure`, and some browsers/privacy
modes block third-party cookies like that outright. Routing the client's
`/api/*` calls through its own nginx to the API container sidesteps the
whole problem — from the browser's perspective there's only one origin, so a
plain `SameSite=Lax` cookie works everywhere.

## Redeploying after a code change

```bash
git pull
docker compose build
docker compose up -d
```

The named volume is untouched by a rebuild, so your data survives.
