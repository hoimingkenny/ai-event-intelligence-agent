# Code Review: Workspace Config hub + read-only lists (#35)

- **Branch:** `feat/workspace-config-35` → `main`
- **Commits:** (this branch)
- **Date:** 2026-07-15
- **Reviewer:** Auto (Composer)

## Summary of change

Adds analyst Workspace Config: hub with active feed/product counts, Config subnav, read-only Feeds and Inventory tables from Postgres via a Workspace Config seam (`src/workspace/workspace-config.ts` — counts, list feeds via `FeedRepository.listAllFeeds`, list inventory). Nav + Overview link. No mutations. Parent: [#35](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/35) / PRD [#34](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/34).

## Behaviour changes

- New analyst routes under `/workspace/config*` (middleware already covers `/workspace/:path*`).
- Workspace nav gains Config; Overview lede links to Config.
- None for pipeline/public catalogue.

## Risks and concerns

- **Inventory “active” uses vendor `is_active`** (current schema / seed mapping). Product-level active and news volume deferred to #36 — accepted for this ticket’s “best-effort current DB shape.”
- **Alias list excludes the product name** when equal (seed often stores product as alias). Analysts still see explicit extra aliases; product column shows the canonical name.

## Test evidence

- `npx vitest run tests/workspace-config.test.ts` — 3 passed
- `npm run check` — pass
- `npm test` — 317 passed / 2 failed (pre-existing MiniMax live API offline) / 5 skipped
- `cd web && npm run build` — pass; routes include `/workspace/config`, `/feeds`, `/inventory`

## Follow-ups

- #36 inventory schema + pipeline load (news volume, product-level active)
- #37 / #38 writes; #39 filter re-queue

## Verdict

Approve — seam-tested read model, thin gated pages, matches #35 acceptance criteria without pipeline changes.
