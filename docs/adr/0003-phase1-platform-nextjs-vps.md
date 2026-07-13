---
status: accepted
---

# Phase-1 platform: Next.js web on one VPS, pipeline separate

We need a standard deploy for a phase-1 product (public Events/Articles + authenticated analyst workspace) without blocking on eval, and without rewriting the batch pipeline into a request/response framework. We decided: **Next.js is the unified web app only** (redesigned public + `/workspace` analyst UI, GitHub OAuth with an env username allowlist). The **pipeline stays a separate Node scheduler** sharing Postgres. Hosting is **one small VPS + Docker Compose** (Postgres/pgvector, Next.js, scheduler) behind Cloudflare for TLS/domain. Infra budget is capped near **$20/mo**; LLM/embedding API spend is a separate dial. Eval UIs (cheap-filter, grouping/gold) remain **local** in this phase. Routes: `/` redirects to `/events`; `/articles` public; `/workspace/*` authenticated; `/api/auth/*` for GitHub.

**In scope:** Next.js app replacing the hosted portal (and hosting the new approval/edit workspace); compose services for web + scheduler + Postgres; GitHub allowlist auth; shared redesign within the phase-1 feature boundary.

**Out of scope:** Running the pipeline inside Next.js route handlers; Vercel/serverless-first web; splitting web and DB across multiple paid always-on providers for phase 1; hosting eval panes on the VPS; BullMQ/Redis as a deploy requirement while batch scheduler remains the trigger.

## Considered options

- **Next.js owns pipeline orchestration** — rejected; couples HTTP timeouts/deploys to long batch runs and advisory-locked stages.
- **Managed split (Neon + Fly/Railway + worker)** — rejected for phase-1 cost/complexity under a tight infra cap.
- **Vercel web + worker elsewhere** — rejected; scheduler/Playwright do not fit serverless web.
- **Strangler (Next proxies old portal)** — rejected; doubles surface on a tiny VPS.
- **GitHub org/team auth or open GitHub login** — deferred / rejected for phase 1; env allowlist fails closed for a small operator set.
- **Host eval inside the logged-in app** — deferred; must not block or bloat the launch box.
