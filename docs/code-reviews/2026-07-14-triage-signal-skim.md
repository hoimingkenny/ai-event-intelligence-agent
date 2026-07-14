# Code Review: Needs triage signal icons + draft membership (#27)

- **Branch:** `feat/triage-signal-skim-27` → `main`
- **Commits:** `7f9f490` (`feat/triage-signal-skim-27`)
- **Date:** 2026-07-14
- **Reviewer:** Auto (implement + two-axis review)

## Summary of change

Enriches Needs triage list items with slim presence signals (monitored vendor/product, CVE, critical cyber keywords) and draft-event membership, and wires Phosphor icons + clickable draft indicator on `/workspace/triage`. Extends the editorial read model (`listArticlesNeedingTriagePage` → `TriageListItem`) per [issue #27](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/27) / [PRD #26](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/26). Glossary updates for Needs triage / Article peek / Workspace article / Human review land in `CONTEXT.md` from the grill session (peek UI deferred to #29).

## Behaviour changes

- `listArticlesNeedingTriagePage` now returns `TriageListItem` (signals + optional draft) instead of bare `ArticleRecord`. Callers that only need id/title/source/date (`/workspace/new`) still work; they pay for extra entity/draft batch queries.
- `listArticlesNeedingTriage` (attach picker) unchanged — still full `ArticleRecord` rows.
- Public catalogue `/articles/[id]` unchanged.

## Risks and concerns

- **Extra queries on Create event page** — accepted for v1; one shared page helper was the agreed seam. Split later if pagination feels slow.
- **Tooltip-only names** — icons use native `title` attribute; fine for desktop analysts; no mobile polish.
- **Draft “most recent”** — ordered by `cyber_events.updated_at DESC`; depends on that column being maintained (schema default/triggers already present).

## Test evidence

- `npm run check` — pass
- `npx vitest run tests/triage-list-skim.test.ts tests/event-editorial-membership.test.ts tests/event-editorial.test.ts` — 21 passed
- Full `npm test` — unrelated `llmHelpers` failures under sandbox (no network to MiniMax); not caused by this change

## Follow-ups

- #28 Workspace article page (title link)
- #29 Article peek drawer (magnifier)
- Optional: dedicated slim list query for `/workspace/new` to skip entity/draft fetches

## Verdict

**Approve-with-notes** — #27 acceptance criteria met at the editorial seam and triage UI; known follow-ups are booked as #28/#29; Create-event over-fetch is an accepted seam trade-off.
