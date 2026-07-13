# Code Review: legacy env vars and LockBit manual articles

- **Branch:** `chore/remove-legacy-env-vars` → `main`
- **Commits:** `40f4a61..7d78e7d`
- **Date:** 2026-07-13
- **Reviewer:** Codex

## Summary of change

The branch removes legacy environment-variable documentation and MiniMax embeddings configuration from the active configuration surface, updates affected legacy callers, and adds three Operation Cronos/LockBit articles to the hand-authored manual-article dataset. The dataset records are the Bleeping Computer, The Hacker News, and SecurityWeek articles supplied for the golden-set sample.

## Behaviour changes

The active embeddings configuration now documents Ollama and OpenAI-compatible providers rather than MiniMax. Existing deployments that explicitly select the removed MiniMax embeddings provider need to move to a supported provider. The three manual articles become available for manual import and cheap-filter review; they do not affect RSS ingestion.

## Risks and concerns

- Legacy scaffold modules still read a small set of historical environment variables directly. This is intentional for the retained legacy scaffold, but means the removal applies to the active pipeline configuration surface rather than every historical code path.
- The added LockBit articles are outside the narrow monitored-product inventory. They are appropriate as manual golden-set samples, but should be treated as non-product-impact examples if used in a product-relevance evaluation.
- The review found no JSONL parse or duplicate-URL issue in the added records.

## Test evidence

- `npm run check` — passed.
- `npm test` — passed: 242 tests passed, 4 skipped.
- Manual JSONL parse with `jq` — passed for the three added records.
- `git diff --check` — passed.

## Follow-ups

- If the legacy scaffold is removed in a future cleanup, consolidate its remaining direct environment reads through the active configuration module.
- Add explicit expected labels when the manual dataset is promoted into a scored evaluation dataset.

## Verdict

Approve with notes: the branch is merge-ready, with the configuration and dataset-scope caveats recorded above.
