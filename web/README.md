# Public web app (Next.js)

Phase-1 public catalogue. Runs on the same VPS as Postgres and the pipeline scheduler (see ADR-0003). Do **not** deploy this to Vercel — the long-running pipeline and `pg` access belong on the VPS compose stack.

## Local

From the repo root (needs `DATABASE_URL` in the root `.env`):

```bash
npm run web:dev    # http://localhost:3000 → /events
npm run web:build
npm run web:start
```

Dev uses webpack (not Turbopack) so parent-package NodeNext `.js` import specifiers resolve to `.ts` via `extensionAlias` in `next.config.ts`. Turbopack does not honor that alias yet, which breaks workspace routes that import `src/events/event-editorial.ts`.

Public routes use the shared catalogue seam (`src/portal/events-portal.ts`, `src/portal/articles-portal.ts`): only **approved** canonical events (with vendor/product impact) and articles attached to them.

Routes: `/` → `/events`, `/events/[id]`, `/articles`, `/articles/[id]`, `/workspace` (GitHub allowlist; edit/approve/unpublish).

## Auth (analyst workspace)

Set in the repo-root `.env`:

```bash
AUTH_SECRET=          # openssl rand -base64 32
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
ANALYST_GITHUB_USERS=your-github-login
```

Create a GitHub OAuth App with callback `http://localhost:3000/api/auth/callback/github` (and the production URL in deploy). Empty `ANALYST_GITHUB_USERS` fails closed — nobody reaches `/workspace`.

Allowlisted analysts can open `/workspace`, create draft events from triage articles, edit fields and membership (attach/detach/move), approve (public visibility), and unpublish (back to draft). Mutations go through `src/events/event-editorial.ts`.
