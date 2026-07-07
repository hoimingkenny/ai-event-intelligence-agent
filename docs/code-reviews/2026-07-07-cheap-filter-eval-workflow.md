# Code Review: Cheap-filter eval human workflow (dataset creation + result review)

- **Branch:** `feat/cheap-filter-eval-workflow` → `main`
- **Commits:** single commit on branch (see `git log feat/cheap-filter-eval-workflow`)
- **Date:** 2026-07-07
- **Reviewer:** Claude

## Summary of change

The cheap-filter evaluation layer had sound metrics/gating but a hostile human boundary: every dataset sample was a hand-written 12-field JSONL line (including five `expectedSignals` booleans that require knowledge of filter internals), and results were only consumable as a flat markdown report. This change makes the human workflow cheap in both directions.

What was added:

1. **Schema relaxation + derivation** (`eval/utils/derive.ts`, rewritten `eval/utils/datasetLoader.ts`). `id`, `expectedMinimumDecision`, and `expectedSignals` are now optional. The minimum decision is derived from `humanLabel` (CRITICAL→KEEP, RELEVANT/WEAK→MAYBE_KEEP, IRRELEVANT→DROP); signals are derived by running the detection modules over title + summary + categories + the free-text `humanReason` (which often names the vendor even when RSS metadata doesn't); ids are derived as `cf-<sha1(url)[:8]>`. Explicitly provided values still win; contradictory `expectedMinimumDecision` values are rejected with line context, as are duplicate ids/urls.
2. **Candidate harvester** (`eval/scripts/harvest-candidates.ts`, `npm run eval:candidates`). Pulls recent filtered articles from Postgres, stratified by cheap-filter decision (defaults 15 KEEP / 15 MAYBE_KEEP / 20 DROP over 14 days; DROPs sampled highest-score-first so near-misses surface). Skips URLs already labeled or already pending, and writes pre-filled candidates to `eval/datasets/cheap-filter-candidates.jsonl`. This also delivers the "shadow sampling of DROPs" follow-up the report has been recommending. Required exporting `inferSourceTier` from `filter-stage.ts` (no behaviour change).
3. **Labeling + report UI** (`eval/server/eval-review-server.ts`, `eval-review-page.ts`, `scripts/serve-eval-review.ts`, `npm run eval:review`, port 4323). File-backed, no DB needed. Label tab: candidate queue with harvest decision/score badges, four label buttons with hints, reason box; saving validates + derives via the same loader code, then appends to the dataset JSONL. Report tab: live evaluation of the current dataset (no stale report files), gate banner, metrics, confusion matrix, and per-sample drill-down (score, filter reasons, blocking reasons, matched signals, suggested fix beside the human reason).
4. **Smaller fixes.** `npm run eval:validate` (validates dataset, prints label counts); markdown report failure tables now sorted by severity with severity + matched-signal columns and gate warnings included; the gate warns when `datasetSize < 50` since 99% recall thresholds are meaningless at n=10.

## Behaviour changes

- Dataset loading now **rejects duplicate ids and duplicate URLs** (previously accepted silently). One pre-existing test reused a URL across samples and was updated.
- `eval/utils/metrics.ts` gate emits an extra warning for datasets under 50 samples (warnings never fail the gate).
- Markdown report failure-table columns changed (added Severity and Matched signals); any downstream parser of that table would need updating (none known).
- `inferSourceTier` in `src/pipeline/filter-stage.ts` is now exported; logic untouched.
- No migrations, no new env vars, no pipeline-stage changes.

## Risks and concerns

- **Derived `expectedSignals` mirror the detectors**, so failure-bucket inference for `missing_vendor_alias` / `missing_critical_phrase` cannot fire from derived values alone (expected == matched by construction). Mitigation: `humanReason` is included in derivation text, which often reintroduces the gap signal; humans can still assert `expectedSignals` explicitly for precise alias-gap analysis. Documented in `derive.ts`.
- **Concurrent labeling** (two browser tabs) could double-append; the server re-checks the dataset before each append and returns 409, but there is no file lock. Accepted: single-operator tool.
- **Harvester over-fetches 3× per stratum** to survive skips; on very large tables `ORDER BY random()` is not cheap. Accepted for current data volumes; add a `TABLESAMPLE` if it ever matters.
- The UI renders with string-concatenated HTML mirroring the existing human-review dashboard; all interpolated values pass through `escapeHtml`/`escapeAttr`.

## Test evidence

- `npm run check`: clean.
- `npm test`: 171 passed / 4 skipped; 3 failures are pre-existing live-API tests (`tests/agents.test.ts`, `tests/llmHelpers.test.ts`) that require MiniMax/OpenRouter network access, unavailable in the sandbox and unrelated to this change.
- New `tests/cheap-filter-eval-workflow.test.ts` (12 tests): derivation mapping, consistency rejection, signal derivation incl. humanReason, stable ids, minimal-record loading, contradiction/duplicate rejection, checked-in dataset still loads, small-N gate warning, server label round-trip (pending→labeled→report), 409 double-label, 404 unknown candidate, candidate store round-trip.
- Manual: `npm run eval:validate`, `npm run eval:cheap-filter` (gate passes, new warning appears), served UI on a test port and exercised `/`, `/api/candidates`, `/api/report` successfully. Harvester not run against a live DB in this session (no Postgres in sandbox); its SQL uses only columns present in `001_core_schema.sql` + migration 011.

## Follow-ups

- Run `eval:candidates` against a live database once and sanity-check stratification.
- Consider inter-rater fields (multiple labels per sample) if a second reviewer joins.
- Optional: "skip candidate" action in the UI for junk rows (currently label IRRELEVANT or leave pending).

## Verdict

Approve-with-notes — mechanical risk is low (eval tooling only, no pipeline behaviour changes), test coverage is direct, and the one semantic tightening (duplicate URL rejection) is deliberate; the harvester's first live-DB run should be observed.
