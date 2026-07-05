# Code Review: Confidence-scored entities + corroboration gate

- **Branch:** `feat/entity-confidence` → `main`
- **Date:** 2026-07-05
- **Reviewer:** Claude

## Summary of change

Makes entity extraction noise-tolerant instead of depending on perfectly clean text (families B + C from the entity-stage discussion). Every entity is born with a confidence from placement (zoned title/lead/body/tail), frequency, and corroboration (co-occurrence with cyber keywords/CVE), computed in the pure module `entity-confidence.ts`. The event boundary (`buildEventDraft`) gates on `MIN_EVENT_ENTITY_CONFIDENCE` (0.5) so low-confidence footer/related-link vendors never drive events, grouping keys, or alerts. Classification cross-checks deterministic vendors against the LLM's `vendorRoles`, down-weighting contradicted ones and recording contradictions in the audit log. Full rationale: `docs/engineering-notes/entity-confidence-and-noise-tolerance.md`.

## Behaviour changes

- **Entity extractor signature changed**: `extractArticleEntities(articleId, fields)` where fields = `{title, summary, body}` (was a flattened string). Zoning needs fields separately. All callers updated.
- **Events are now gated by entity confidence**: an article whose only vendor is a low-confidence tail mention produces `groupingKey: 'unknown'` and no affected vendor — previously it created a (likely false) vendor event. This is the intended correctness improvement; expect fewer, higher-precision events.
- **Classification stage** now reconciles vendor entity confidence in the DB and adds `contradictedVendors` to the classification audit payload; `ClassificationStageResult` gains `vendorsReconciled` (additive).
- No migration: `article_entities.confidence` already existed (previously unset).

## Risks and concerns

- **Threshold values (zone weights, 0.45 uncorroborated cap, 0.5 gate) are priors.** Unit tests pin the behaviour; calibration awaits the verdict→eval-set export. A too-high gate could suppress real low-signal events — mitigated by the gate being one exported constant, easy to tune, and by low-confidence entities remaining stored (visible in review) rather than discarded.
- **CVE-only-in-tail down-scoring** could in principle weaken a legitimately tail-cited CVE; accepted as rare and recoverable (the vendor/attack-type signal usually corroborates).
- Cross-check updates entity confidence *after* events are already grouped, so it does not re-derive events this pass — it improves audit visibility and future re-grouping, not the current event. Noted as a follow-up (re-grouping on reconciliation).

## Test evidence

- `npm run check` clean.
- `vitest`: 125 passed / 4 skipped; 3 failures are the pre-existing live MiniMax network tests only. 14 new tests (scoring boundaries, zoning, cross-check, contradiction list, end-to-end title-vs-footer vendor); event-grouper gains a low-confidence-exclusion test; existing extractor/grouper/runner tests updated for the new shapes.

## Follow-ups

Calibrate thresholds against the exported human-review eval set; re-group events when the cross-check materially changes vendor confidence; extend confidence to role assignment (currently `unknown` until the LLM sets it).

## Verdict

**Approve.** Converts the most damaging leak (false vendor → false alert) from "depends on perfect cleaning" to "tolerated and gated", with pure, unit-tested decision logic and observable cross-checks.
