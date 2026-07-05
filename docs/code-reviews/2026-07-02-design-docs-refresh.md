# Code Review: Design docs refresh

- **Branch:** `docs/design-refresh` → `main`
- **Date:** 2026-07-02
- **Reviewer:** Claude

## Summary of change

Docs-only. Brings `docs/design/` in line with the implemented system after the extraction, grouping-ladder, and early-warning-alerting merges. `architecture.md` rewritten (was describing the LangGraph/OpenAI-Agents/Qdrant scaffold era): now documents the pipeline state machine, the ladder pattern, layered extraction, two-tier alerting, self-monitoring, and work ordering. `data-model.md` gains `grouping_key`, quality columns (`rss_recall`, `content_quality_score`), `alert_tier`, and the status state machine. `evaluation.md` adds the implemented production self-evaluation (rss_recall, drift, latency SLO) and fixture regression. `tradeoffs.md` adds six decisions made since (Playwright disabled, structure-based ad removal, two-tier noise acceptance, newest-first ordering, fail-open comparator, measurement-before-automation, single-purpose LLM calls). `limitations.md` rewritten and re-ordered by impact on the early-warning mission, including honest gaps (secondary sources, unused trust_level, batch sweeps, unvalidated thresholds, prompt injection).

## Behaviour changes

None — documentation only.

## Test evidence

Not applicable (no code changed); docs cross-checked against current source.

## Verdict

**Approve.** Design docs are declared "kept up to date" in docs/README.md; they now are.
