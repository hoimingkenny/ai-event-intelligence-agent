# Code Review: Derive grouping-pair eval from gold incidents

- **Branch:** `feat/derive-grouping-from-gold` → `main`
- **Commits:** (this change)
- **Date:** 2026-07-13
- **Reviewer:** Cursor agent
- **Spec:** [#5 Derive grouping-pair eval from gold incidents](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/5)

## Summary of change

Gold incidents become the sole source of truth for grouping-pair eval labels. Within-basket pairs derive as `same_event`; cross-basket pairs derive as `different_event` in memory at report time. The pair JSONL stores only `uncertain` overrides. Overlapping article URLs across gold incidents are rejected. Dashboard removes bulk-same and Ad-hoc labeling; overrides are set from within-basket pairs or the threshold tuner list.

## Behaviour changes

- `GET /api/grouping-eval/report` derives pairs from gold + overrides instead of reading materialized same/different rows.
- `GET/POST /api/grouping-eval/pairs` is uncertain-overrides only; `DELETE` clears an override.
- Removed `POST /api/grouping-eval/incidents/bulk-same`.
- `upsertGoldIncident` returns 409 on article URL overlap with another incident.
- Cleared legacy same_event rows from `eval/datasets/grouping-pair-eval.jsonl` (SailPoint/SharePoint gold incidents retained).
- Append/upsert rewrite the overrides file to uncertain-only so leftover legacy rows cannot 409 new overrides.

## Risks and concerns

- **Mis-curated gold baskets** poison both same and different clouds — mitigated by overlap reject + uncertain overrides.
- **Full cross-product at large gold counts** may slow the tuner UI — accepted for now; hard-negative sampling is an explicit follow-up.
- **Orphan uncertain overrides** after basket edits remain loadable — visible in derived set; can be cleared from tuner.

## Test evidence

- `npm run check` — pass
- `npx vitest run --exclude tests/llmHelpers.test.ts` — 237 passed / 4 skipped
- New unit coverage: derive pairs, overlap guard, uncertain-only persistence

## Follow-ups

- Hard-negative sampling (K nearest cross pairs) when gold incident count is large
- Route-level HTTP workflow tests for grouping eval

## Verdict

**Approve-with-notes** — matches #5 locked design; sampling deferred deliberately.
