# Code Review: cheap-filter layered cascade

- **Branch:** `feat/cheap-filter-layered-cascade` → `main`
- **Commits:** pending
- **Date:** 2026-07-08
- **Reviewer:** Codex

## Summary of change

Implements the layered cheap-filter cascade described in
`docs/plans/cheap-filter-layered-cascade-plan.md` and
`docs/design/cheap-filter-layered-cascade.md`.

The filter now gates RSS metadata in three steps: monitored vendor/product relevance, cyber context,
then priority scoring. Vendorless severe signals are no longer promoted to `KEEP`; they are capped
at `MAYBE_KEEP` for downstream extraction and LLM review. Critical keywords are split into
exploitation-class and incident-class signals, while the persisted `FilterDecision` shape remains
unchanged.

## Behaviour changes

- `decideCheapFilter()` no longer uses one flat additive score to decide relevance.
- Vendor/product relevance is now a precondition unless the severe-signal escape hatch fires.
- Vendorless CVE/zero-day/official-source items become `MAYBE_KEEP`, not `KEEP`.
- Vendor PR/business stories now terminate in Layer 2 with layer-specific blocking reasons.
- Monitored vendor inventory now has `newsVolume: "quiet" | "noisy"` with a default of `quiet`.
- The inventory dashboard can view and edit `newsVolume`.

## Risks and concerns

- The labelled dataset still has only 15 samples. The eval gate passes, but the report warns that
  recall metrics are coarse below 50 samples. This is the main residual risk.
- Hard gates can create false drops if RSS metadata omits both vendor and severe signal. The escape
  hatch preserves CVE/exploitation/official-source items as `MAYBE_KEEP`.
- Noisy-vendor strictness depends on inventory quality. The schema default is conservative for
  backwards compatibility, and noisy vendors are explicit in `config/monitored-vendors.json`.

## Test evidence

- `npm run check` passed.
- Focused suite passed with localhost permission:
  `npm test -- --run tests/detection.test.ts tests/cheap-filter-stage.test.ts tests/cheap-filter-evaluation.test.ts tests/cheap-filter-eval-workflow.test.ts`
  → 44 passed.
- `npm run eval:validate` passed:
  15 valid samples; warning retained for fewer than 50 samples.
- `npm run eval:cheap-filter` passed:
  dataset size 15, critical recall 100.0%, relevant recall 100.0%, false negative rate 0.0%,
  pass-through rate 60.0%, gate passed.

## Follow-ups

- Grow the labelled dataset to at least 50 samples, including the adversarial categories listed in
  the implementation plan.
- Compare cascade reports against a saved additive baseline once the dataset is large enough to
  trust.
- Consider adding `criticalExploitation` / `criticalIncident` to dashboard drill-downs if reviewers
  need to see the split directly.

## Verdict

Approve with notes: the implementation matches the target cascade and passes the current gate, but
the small evaluation dataset remains the important quality-control caveat.
