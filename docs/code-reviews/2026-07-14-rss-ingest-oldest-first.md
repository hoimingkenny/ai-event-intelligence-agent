# Code Review: RSS ingest oldest-first IDs

- **Branch:** `feat/rss-ingest-oldest-first` → `main`
- **Commits:** (this change)
- **Date:** 2026-07-14
- **Reviewer:** Auto (implement)

## Summary of change

Within each ingest run, fetch all selected feeds, normalize, then insert in one global order: `published_at` ascending (null dates last; feed list order then item index as tie-break). Older articles in that **batch** get smaller `BIGSERIAL` ids across feeds. Manual article import is unchanged.

## Behaviour changes

- New articles from a single ingest run are no longer inserted per-feed (or in raw RSS item order). Chronology across the whole batch drives insert order and therefore new ids.
- Guarantee is per ingest batch only — no remapping of existing ids; a later-discovered older article still gets a new larger id.

## Risks and concerns

- Cross-run chronology vs id remains best-effort (accepted).
- One failed feed still allows the rest of the batch to insert; that feed does not bump `last_fetched_at`.

## Test evidence

- `npm run check` — pass
- `tests/rss-ingestion.test.ts` — cross-feed batch order case (older from feed B before newer from feed A)

## Follow-ups

None.

## Verdict

**Approve** — matches the revised global-batch ingest-order decision.
