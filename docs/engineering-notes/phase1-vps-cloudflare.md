# Phase-1 VPS + Cloudflare runbook

How to run the production-shaped Compose stack from ADR-0003 on one small VPS
(~$20/mo infra) with Cloudflare for TLS and DNS. Eval / review UIs stay local
(`npm run eval:review`, `npm run review:dashboard`); they are not part of this
deploy.

## Services (default profile)

| Service | Role |
|---|---|
| `postgres` | Postgres + pgvector |
| `migrate` | Applies SQL migrations once, then exits |
| `scheduler` | Batch pipeline loop (separate from Next.js) |
| `web` | Next.js public catalogue + `/workspace` |

Optional profiles:

- `--profile legacy` — old `portal` (:4322) and `dashboard` (:4321)
- `--profile queue` — Redis for BullMQ worker mode (not required for the batch scheduler)

## On the VPS

1. Install Docker Engine + Compose plugin.
2. Clone the repo; copy `.env.example` → `.env` and fill:
   - `DATABASE_URL` (overridden inside Compose to the `postgres` service URL)
   - LLM / embedding keys used by the scheduler
   - `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `ANALYST_GITHUB_USERS`
   - `AUTH_URL=https://<your-domain>` (no trailing slash)
3. Create a GitHub OAuth App with callback  
   `https://<your-domain>/api/auth/callback/github`
4. Bring the stack up:

```bash
docker compose up -d --build
```

5. Confirm:

```bash
docker compose ps
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/events
```

`web` listens on `127.0.0.1:3000` only. Do not publish `:3000` on the public
interface unless you have IP allowlists (Cloudflare IP ranges) or equivalent.

Seed vendors/feeds once after first healthy migrate if the DB is empty:

```bash
docker compose run --rm migrate npm run db:seed
```

## Cloudflare (TLS + domain)

**Recommended: Cloudflare Tunnel** (no open origin ports for the app)

1. Add the domain to Cloudflare; DNS stays orange-clouded as needed.
2. Install `cloudflared` on the VPS; create a tunnel to `http://127.0.0.1:3000`.
3. Route `<your-domain>` (and `www` if wanted) to that tunnel.
4. Set `AUTH_URL=https://<your-domain>` and restart `web`.

**Alternative: DNS-only / proxied origin on a host port**

1. Reverse-proxy on the VPS (Caddy/nginx) from `:443` → `127.0.0.1:3000`, or
   bind the Compose port carefully and allow only Cloudflare IPs.
2. Use Cloudflare Full (strict) SSL with an origin cert if terminating TLS on the VPS.
3. Same GitHub callback + `AUTH_URL` as above.

## Budget intent

- One small VPS (shared CPU / ~1–2 GB RAM is the target class) + Cloudflare Free.
- LLM and embedding API spend is **outside** the ~$20/mo infra cap.
- Do not add always-on Redis / workers for phase 1 unless you opt into `--profile queue`.

## Ops notes

- Scheduler and web share Postgres; never run the pipeline inside Next.js route handlers.
- `migrate` failing aborts a clean deploy — fix schema before traffic.
- Scheduler `stop_grace_period` is 60s so an in-flight run can finish on deploy.
- For overlap safety see [deployment-and-scheduling.md](./deployment-and-scheduling.md).
