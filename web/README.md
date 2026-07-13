# Public web app (Next.js)

Phase-1 public catalogue. Runs on the same VPS as Postgres and the pipeline scheduler (see ADR-0003). Do **not** deploy this to Vercel — the long-running pipeline and `pg` access belong on the VPS compose stack.

## Local

From the repo root (needs `DATABASE_URL` in the root `.env`):

```bash
npm run web:dev    # http://localhost:3000 → /events
npm run web:build
npm run web:start
```

Public routes use the shared catalogue seam (`src/portal/events-portal.ts`): only **approved** canonical events with vendor/product impact.
