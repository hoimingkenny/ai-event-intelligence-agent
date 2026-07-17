# Code Review: Digest eval scoring and offline runner (#53)

- **Branch:** `feat/digest-eval-runner-53` → `main`
- **Commits:** (pending commit on branch)
- **Date:** 2026-07-17
- **Reviewer:** Auto (implement + two-axis review)

## Summary of change

Adds offline digest evaluation: pure scoring (`evaluateDigestEvalSamples`), Postgres run/prediction tables, baseline runner (stored `llm_article_digest` vs gold), regen runner (offline `digestArticleAgainstInventory` on frozen snapshots), CLI (`npm run eval:digest`), and JSON/markdown reports under `eval/reports/`. Implements [ADR 0005](../adr/0005-digest-eval-gold-and-runs.md) scoring/run slice; gold labeling (#52) is a prerequisite.

## Behaviour changes

- New migration `020_digest_eval_runs.sql` creates `digest_eval_runs` and `digest_eval_predictions`.
- `npm run eval:digest` scores baseline stored digests; `npm run eval:digest -- --regen` runs offline LLM digest (requires `MINIMAX_API_KEY`) without mutating `articles.llm_article_digest`.
- Soft gate warnings (not CI fail) when gold count ≥ 40: relatedness F1 < 0.80, vendor/product exact < 0.70, CVE exact < 0.75.
- Regen runs optionally compare metrics to the latest finished baseline run.

## Risks and concerns

- **Failed prediction scoring:** On LLM/parse errors, runner scores an empty unrelated prediction so infra failures look like prediction misses. `error_message` is persisted in Postgres but not yet surfaced in report failure rows. Accepted for PoC; follow-up for #54 reports panel.
- **Gold count gate:** Soft gates inactive below 40 labels — expected per spec.
- **Cross-layer imports:** `src/evaluation/digest/` imports `eval/utils` types; mirrors cheap-filter eval direction with acceptable PoC coupling.

## Test evidence

- `npm run check` — pass
- `npm test -- tests/digest-evaluation.test.ts tests/digest-eval-runner.test.ts` — 6/6 pass
- `npm test` — 372 pass, 2 fail (pre-existing `llmHelpers.test.ts` network calls when `MINIMAX_API_KEY` is set), 6 skipped

## Follow-ups

- Surface `error_message` in report failure rows (#54).
- Test comparison-delta path when a prior baseline run exists.
- Workspace reports panel (#54) to browse run history.

## Verdict

**Approve-with-notes** — Meets #53 acceptance criteria; failed-sample reporting polish can land with #54.
