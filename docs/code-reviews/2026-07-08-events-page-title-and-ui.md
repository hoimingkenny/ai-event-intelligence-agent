# Code Review: Events Page Title and UI

- **Branch:** `feat/cheap-filter-layered-cascade` → `main`
- **Commits:** pending
- **Date:** 2026-07-08
- **Reviewer:** Codex

## Summary of change

Implemented the event-title/UI plan in `docs/plans/events-page-title-and-ui.md`. Events now have a `summary_stale` flag, material updates mark their event for regeneration, a new `summarize:events` stage generates channel-ready event titles/summaries after classification rollup, and the read-only portal now presents events as a six-column human monitoring table.

## Behaviour changes

Adds migration `014_event_summary_stale.sql` with `cyber_events.summary_stale` and a partial index for missing/stale summaries. The full pipeline now runs `summary_stage` after `classification_stage` when LLM stages are enabled. `saveLlmSummary()` clears the stale flag, and material-update attachments set it. A new command, `npm run summarize:events`, can be run independently.

The Events tab no longer shows CVEs in the list view. It shows description, vendor/product, severity, confidence, source count, and first-seen/last-update timing. CVEs remain visible in event detail.

## Risks and concerns

The summary stage is another LLM call path, so model/API failures can leave draft titles in place. That failure mode is deliberate: errors write `llm_audit_logs` rows and the event remains retryable because `summary_stale` is not cleared.

Event embeddings still run before classification and summary generation in the current graph. This preserves existing ordering but means event embeddings are based on draft event text until a later embedding refresh policy exists.

## Test evidence

- `npm test -- tests/summary-stage.test.ts tests/event-repository.test.ts tests/events-portal.test.ts tests/llm-schemas.test.ts tests/pipeline-runner.test.ts` — passed, 14 tests.
- `npm run check` — passed.
- `npm test` — passed with localhost/network permissions, 194 passed / 4 skipped.

## Follow-ups

Add an explicit event-embedding refresh when a summary changes, if semantic event search starts depending on the generated title/summary. Consider surfacing summary-age/staleness in the portal detail after real analyst use.

## Verdict

Approve with notes — the design cleanly separates model generation from read-only monitoring, with retryable failure behavior and audit visibility.
