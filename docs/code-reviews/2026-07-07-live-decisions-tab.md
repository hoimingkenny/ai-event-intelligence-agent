# Code Review: Live filter-decisions tab in the eval review UI

- **Branch:** `feat/cheap-filter-eval-workflow` → `main`
- **Commits:** third commit on branch (after `74a55ca`)
- **Date:** 2026-07-07
- **Reviewer:** Claude

## Summary of change

Adds a human review dashboard for the cheap-filter stage by extending the existing eval review UI (`npm run eval:review`, :4323) rather than building a new one. A new "Live decisions" tab reads real, already-filtered articles from Postgres (`cheap_filter_*` columns): decision distribution counts (KEEP/MAYBE_KEEP/DROP), a filterable list of the latest decisions, and per-article detail showing the filter's score, reasons, blocking reasons, and matched signals. Any article can be labeled in place — the same four-button judgement panel appends it to the eval dataset, so reviewing real decisions and growing the dataset are one motion. Articles already in the dataset are badged and cannot be double-labeled.

Server changes: `EvalReviewServerOptions` takes an optional `db: Queryable`; new endpoints `GET /api/decisions` (list + summary, `decision`/`limit` params, capped at 200) and `POST /api/labels/from-article` (validates via the same `normalizeDatasetRecord` path as candidate labeling). `scripts/serve-eval-review.ts` connects using `DATABASE_URL` when available, probes with `SELECT 1`, and degrades to file-only mode (with an in-UI hint) when the DB is unreachable or `--no-db` is passed.

## Behaviour changes

- `npm run eval:review` now attempts a DB connection at startup; on failure it warns and continues (previous behaviour preserved). No schema, migration, or pipeline changes. Reads only; the single write path is the existing dataset JSONL append.

## Risks and concerns

- `sourceTier` for live articles is inferred from `source_name` via `inferSourceTier` (no tier column exists). A misleading source name yields a wrong tier in the labeled sample; visible in the UI before saving, and correctable in the JSONL.
- Deleted upstream: none. Duplicate-URL protection is re-checked server-side before each append (409).
- DB queries are bounded (`LIMIT`, capped at 200) and indexed by nothing specific — acceptable at POC volumes (~1.1k articles).

## Test evidence

- `npm run check`: clean.
- `npm test`: 174 passed / 4 skipped; only the 3 pre-existing MiniMax/OpenRouter live-API tests fail (network-dependent, unrelated).
- New tests (stubbed `Queryable`): decision listing with summary + tier inference + `alreadyLabeled` flag; label-from-article appends a valid derived sample and blocks relabeling with 409; disabled-mode response without a DB.
- Manual: served with `--no-db`, verified `/api/decisions` disabled payload and tab rendering.

## Follow-ups

- Run against the real 1.1k-article database and sanity-check the MAYBE_KEEP queue ergonomics.
- Consider a "recheck with current filter" action that re-runs `decideCheapFilter` on a stored article to preview tuning changes before re-running the stage.

## Verdict

Approve — additive, read-mostly, reuses the validated labeling path, and degrades cleanly without a database.
