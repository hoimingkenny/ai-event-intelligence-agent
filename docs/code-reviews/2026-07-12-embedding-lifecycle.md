# Code Review: Embedding lifecycle redesign (ADR-0001)

- **Branch:** `feat/diagnose-sailpoint-event-split` → `main`
- **Date:** 2026-07-12
- **Reviewer:** Cursor agent

## Summary of change

Implements [ADR-0001](../adr/0001-embedding-lifecycle.md) / [plan](../plans/embedding-lifecycle-redesign.md): a single embedding lifecycle owns article and event vectors, persists provenance, filters similarity to the current model, groups only `EMBEDDED` articles, copies the creating article vector onto new events, and sweeps missing event vectors with bounded retry.

## Behaviour changes

- Migration `016_embedding_provenance.sql` adds provenance (+ event retry) columns; null-provenance vectors are ineligible for similarity.
- Event stage no longer considers `ENTITY_EXTRACTED` articles.
- On event create, `event_embedding` is copied from the creating article (not template-embedded).
- Event embedding stage is a copy/sweep only (no template embed API calls).
- Article embed failures increment `retry_count` and `IGNORED` after `EMBEDDING_MAX_RETRIES` (default 5).
- New operator command: `npm run embed:reembed` (`scripts/reembed-for-model-change.ts`).

## Risks and concerns

- **Thresholds unchanged (0.15/0.35).** SailPoint diagnose loop still exits 2 with Ollama 4B: SC Media lands at ~0.151 (just over attach). Accepted per ADR as threshold follow-up, not a lifecycle failure — Security Affairs now attaches at ~0.13 once SC Media created event-2.
- Operators must run migration 016 before deploy; until re-embed, old vectors won't participate in similarity.
- Copy-on-create requires the creating article to already have current-model provenance (true for `EMBEDDED`-only candidates).

## Test evidence

- `npm run check` — pass
- `npm test` — 203 passed, 1 previously failing manual-articles count assertion updated (≥3)
- `npx tsx scripts/diagnose-same-event-grouping.ts` with local Ollama — **RED exit 2** (2 events); distances improved vs template asymmetry; remaining miss attributed to uncalibrated thresholds

## Follow-ups

- Model-scoped threshold registry / labeled-pair eval
- Centroid event vectors on attach
- Semantic dedup wiring (deferred)

## Verdict

**Approve-with-notes** — lifecycle seams match ADR-0001; residual SailPoint split is the deferred threshold work, not a regression of this change.
