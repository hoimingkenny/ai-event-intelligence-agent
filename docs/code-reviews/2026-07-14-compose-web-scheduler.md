# Code Review: Compose Next.js + scheduler + Postgres (#17)

- **Branch:** `feat/compose-web-scheduler-postgres` → `main`
- **Commits:** (this PR)
- **Date:** 2026-07-14
- **Reviewer:** Cursor agent

## Summary of change

Production-shaped Docker Compose for phase 1 (ADR-0003): Postgres/pgvector, migrate, batch `scheduler`, and Next.js `web` on one host. Legacy portal/dashboard and Redis move behind Compose profiles. Adds `Dockerfile.web` (standalone), `.dockerignore`, `AUTH_URL` in `.env.example`, and a short VPS + Cloudflare runbook.

## Behaviour changes

- `docker compose up -d` default services: `postgres`, `migrate`, `scheduler`, `web` (not Redis / legacy portal / dashboard).
- `web` publishes `127.0.0.1:3000` only; TLS/domain expected via Cloudflare Tunnel or host reverse proxy.
- Redis requires `--profile queue`; old portal/dashboard require `--profile legacy`.
- Next.js production image uses `output: 'standalone'`; Docker builds set `DOCKER_BUILD=1` to skip Next’s in-image typecheck of parent `src/` (root `npm run check` remains the gate).

## Risks and concerns

- **Docker typecheck skip** — `DOCKER_BUILD=1` still skips Next’s parent-`src` typecheck (false positives under web/tsconfig), but `Dockerfile.web` runs root `npm run check` first and fails the image build if it fails.
- **Approve requires vendor or product** — editorial hard-block; public catalogue visibility is publication status only (aligned after 2026-07-14 clarification on ADR-0002).
- **No live full-stack e2e in this PR** — validated `docker compose config`, local `web:build` / `check`, and targeted portal/editorial tests. Operators still need LLM keys for a useful scheduler run.
- **Playwright browsers** in the pipeline image remain a pre-existing gap for sources that need Playwright extraction.
- **Postgres password still compose-default (`cyber`)** — fine for PoC VPS; harden before broader exposure.

## Test evidence

- `docker compose config --services` → `postgres migrate scheduler web`
- `docker compose --profile legacy --profile queue config --services` includes portal/dashboard/redis
- `docker build -f Dockerfile.web -t vendor-threat-watch-web:test .` — success
- `npm run check` — success
- `npm run web:build` — success (standalone)

## Follow-ups

- Harden DB credentials / secrets for real prod
- Optional: Playwright install layer on pipeline image
- Eval remains local (by design)

## Verdict

Approve — matches #17 ACs and ADR-0003 (web separate from scheduler, Next is hosted catalogue, eval off-VPS).
