# Code Review: Grouping pair eval portal + threshold tuner

- **Branch:** `feat/grouping-pair-eval` → `main`
- **Commits:** `7e433b5`
- **Date:** 2026-07-12
- **Reviewer:** Cursor agent
- **Spec:** [#2 Grouping pair eval portal + visual threshold tuner](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/2)

## Summary of change

Adds a **Grouping eval** top-level tab on `npm run review:dashboard` so operators can manually build gold incidents, label article pairs (`same_event` / `different_event` / `uncertain`), persist them in committed JSONL, and interactively tune embedding attach/uncertain thresholds via a visual plot + sliders. Pure evaluator seam mirrors cheap-filter eval; distances are article↔article from current-model embeddings. Spec: [#2](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/2).

## Behaviour changes

- New dashboard tab and `/api/grouping-eval/*` routes (no change to pipeline grouping decisions or production threshold constants).
- New datasets: `eval/datasets/grouping-pair-eval.jsonl`, `eval/datasets/grouping-gold-incidents.jsonl` (empty seeds, committed).
- Pair labels support append (409 on duplicate) and `?upsert=1` replace for per-pair overrides after bulk-same.
- Glossary terms: Grouping pair label, Gold incident (`CONTEXT.md`).
- `docs/design/ui-and-dashboards.md` updated for three panes + grouping routes.

## Risks and concerns

- **Small label sets → noisy suggestions.** Mitigated: suggestions are display-only; no auto-apply to config.
- **Article↔article vs article↔event.** Accepted for v1 under copy-on-create (ADR-0001); centroid follow-up will need recalibration.
- **JSONL race if multiple writers.** Same acceptance as cheap-filter eval (single-process dashboard).
- **Tuner/search require DB;** incident/pair file APIs work without DB except article picker and report scoring.

## Test evidence

- `npm run check` — pass
- Grouping unit tests — 12 passed (`grouping-pair-dataset`, `grouping-pair-metrics`, `grouping-cosine-distance`)
- Broader suite excluding live `llmHelpers` — 217 passed / 4 skipped

## Follow-ups

- Hybrid candidate-pair harvesting
- Auto-apply thresholds / model-scoped threshold registry
- LLM classification eval tab
- Article↔event scoring after centroids
- Shared `cosineDistance` with diagnose script; route-level workflow tests

## Verdict

**Approve-with-notes** — matches issue #2; threshold application remains a deliberate human step; per-pair override via upsert addresses US7.
