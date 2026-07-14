# Code Review: RSS ingest oldest-first IDs

- **Branch:** `feat/rss-ingest-oldest-first` → `main`
- **Commits:** (this change)
- **Date:** 2026-07-14
- **Reviewer:** Auto (implement)

## Summary of change

Within each RSS feed fetch, normalize all items, then insert in `published_at` ascending order (null dates last; original feed index as tie-break) so older articles in that batch get smaller `BIGSERIAL` ids. Manual article import is unchanged.

## Behaviour changes

- New articles from a single feed ingest are no longer inserted in raw RSS item order (usually newest-first). Chronology within that batch drives insert order and therefore new ids.
- Guarantee is per feed, per ingest batch only — no remapping of existing ids.

## Risks and concerns

- Cross-run chronology vs id remains best-effort (a later-discovered older item still gets a new larger id). Accepted by design.
- Concurrent multi-feed runs still interleave id ranges by feed processing order; out of scope.

## Test evidence

- `npm run check` — pass
- Full suite: 320 passed, 1 skipped (with `DATABASE_URL`)
- New case: `assigns smaller article ids to older items within a feed batch` in `tests/rss-ingestion.test.ts`

## Follow-ups

None.

## Verdict

**Approve** — matches the grilled ingest-order decisions; surgical change at the agreed `ingestRssFeeds` seam.
