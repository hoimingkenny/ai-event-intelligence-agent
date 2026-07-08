# Cheap-Filter Layered Cascade — Implementation Plan

Target design: [docs/design/cheap-filter-layered-cascade.md](../design/cheap-filter-layered-cascade.md).
Current engine being replaced: [docs/design/cheap-filter-rule-engine.md](../design/cheap-filter-rule-engine.md).

## Goal

Replace the flat additive score in `decideCheapFilter` (`src/pipeline/filter-stage.ts`) with a
three-layer cascade — vendor gate (with severe-signal escape hatch) → cyber-context gate →
priority score — so that relevance is a precondition for intensity, not an addend. Ship it only
when the cheap-filter eval gate proves it strictly better than the additive engine on a dataset
large enough to trust.

## Non-goals

- **No LLM call inside the cheap filter.** It stays a pure, deterministic, sub-millisecond
  function over RSS metadata.
- **No body-text access.** The filter's input remains title + rssSummary + rssCategories +
  sourceTier; anything needing extracted text belongs to the classification stage.
- **No `FilterDecision` interface change.** decision / score / reasons / blockingReasons /
  matchedSignals keep their shapes; only reason-code *values* are added. Dashboards, eval harness,
  and the status mapping in `runCheapFilterStage` keep working unmodified.
- **No keyword-list rewrite.** Tier membership stays governed by the
  [classification standard](../design/cyber-keyword-classification-standard.md); this plan only
  changes how tiers are *used*. The one taxonomy change needed (exploitation-class vs
  incident-class split inside critical) is Phase 2.
- **No downstream stage changes.** KEEP → `EXTRACTION_PENDING`, MAYBE_KEEP →
  `EXTRACTION_PENDING_LOW_PRIORITY`, DROP → `IGNORED` mapping is untouched.

## Phase 0 — grow the eval dataset (blocking precondition)

The labelled set has 15 samples; the eval report itself warns recall thresholds are statistically
weak below 50. No filter change merges against a 15-sample gate.

1. Author adversarial negatives via `eval/datasets/manual-articles.jsonl` + `npm run
   articles:manual`, then label them in the review dashboard's Live decisions tab:
   - vendor + business news (earnings, launches, partnerships, hires) — one per monitored vendor
   - cyber-heavy + unmonitored vendor (ransomware/incident stories with zero inventory relevance)
2. Author hard positives the same way:
   - CVE-only titles (no vendor name in metadata)
   - vendor-less exploitation phrasing ("zero-day in popular PAM solution")
   - quiet-vendor medium-keyword advisories (CyberArk + "vulnerability", no critical keyword)
3. Harvest real candidates with `npm run eval:candidates` and label in the dashboard.
4. Exit criteria: **≥ 50 labelled samples**, with ≥ 5 in each adversarial category above, and
   `npm run eval:validate` passing.

## Phase 1 — restructure without behavior change

Refactor `decideCheapFilter` into explicit named stages (signal extraction → gates → score) while
reproducing the additive engine's decisions bit-for-bit. Pure mechanical move.

- Extract the signal-collection block into one function returning the matched-signals struct.
- Introduce a decision pipeline shape (ordered evaluators) that currently contains a single
  evaluator: the existing five-branch tree.
- Verify: full test suite green, and `npm run eval:cheap-filter` report identical
  (same confusion matrix, same per-sample decisions) before and after.

## Phase 2 — keyword taxonomy split

Split the critical tier inside `src/detection/cyber-keyword-classifier.ts` into
exploitation-class (standard §4.1 active exploitation + §4.2 zero-day/emergency) and
incident-class (§4.3–4.5) sub-tiers, exposed as separate arrays on the classifier result.
Additive scoring treats them identically for now, so eval output must again be unchanged.
Update the standard doc to record the split.

## Phase 3 — the cascade

Implement the three layers behind the Phase-1 pipeline shape, in one PR:

1. **Layer 1** — vendor/product gate. No match → escape hatch (CVE present, or
   exploitation-class critical keyword, or `official_vendor`/`government_cert` tier).
   Hatch pass → MAYBE_KEEP with a permanent cap; hatch fail → DROP.
2. **Layer 2** — cyber-context gate (CVE, or critical keyword, or medium keyword +
   corroboration, or trusted tier; negative-dominance veto). Fail → DROP.
3. **Layer 3** — priority score over source tier, keyword tier, product-vs-vendor specificity,
   recency, categories; single threshold picks KEEP vs MAYBE_KEEP.
4. **Per-vendor strictness** — add a news-volume field (`quiet` | `noisy`) to the monitored-vendor
   inventory schema (`parseVendorInventory` Zod + `config/monitored-vendors.json` + inventory
   dashboard tab), replacing the hardcoded `NOISY_VENDOR_NAMES` set. Noisy vendors require
   corroborated medium keywords at Layer 2; quiet vendors accept medium alone.
5. **Telemetry** — new blocking reason codes name the terminating layer
   (`cheap_filter_l1_no_vendor_no_severe_signal`, `cheap_filter_l2_no_cyber_context`,
   `cheap_filter_l2_negative_dominance`); existing codes that still apply keep their values so
   historical rows stay comparable.

Unit tests: one test per row of the design doc's worked routing table, plus invariants 1–3
(score can neither resurrect a gated DROP nor demote a double-gate pass below MAYBE_KEEP; hatch
articles never KEEP).

## Phase 4 — evaluate, tune, decide

1. Run `npm run eval:cheap-filter` on the additive engine (baseline) and the cascade against the
   Phase-0 dataset; keep both reports in `eval/reports/`.
2. Acceptance gate — merge only if, versus baseline:
   - critical recall = 100% (unchanged)
   - relevant recall ≥ baseline
   - irrelevant pass rate strictly lower
   - pass-through rate strictly lower
3. Use the report's per-sample failure drill-down (now layer-tagged) to tune the Layer-2
   corroboration rule and the Layer-3 threshold. If the gate cannot be met without breaking
   critical recall, stop and write an engineering note on why — do not weaken the gate.
4. Optionally run the LLM judge (`LLM evaluation` tab) over a fresh pipeline run for a second
   opinion on disagreements.

## Phase 5 — docs and merge

- Rewrite [cheap-filter-rule-engine.md](../design/cheap-filter-rule-engine.md) to describe the
  implemented cascade (it documents *what is*); flip the cascade design doc's status to
  "implemented".
- Update the standard's §13 decision policy to match.
- Code review doc in `docs/code-reviews/` per the development workflow; `npm run check` +
  `npm test` green; merge.

## Risks

| Risk | Mitigation |
|---|---|
| Hard gates tank recall in ways the small dataset can't see | Phase 0 is blocking; hatch + MAYBE_KEEP escape valves; false-DROP asymmetry principle baked into gate design |
| Exploitation/incident keyword split is judgment-heavy | Anchor strictly to standard §4.1–4.2 vs §4.3–4.5; record deviations in the standard |
| Inventory schema change breaks the eval dashboard's inventory tab | News-volume field optional with a `quiet` default; Zod parse covers both shapes during transition |
| Reason-code churn breaks eval failure buckets | Keep existing codes; only add layer-prefixed ones; eval aggregation treats unknown codes as pass-through |
| Tuning Layer 3 on the same dataset it's judged by | Keep the harvested-candidates stream flowing during Phases 3–4 so fresh labels arrive after the design freeze |

## Files expected to change

| File | Change |
|---|---|
| `src/pipeline/filter-stage.ts` | cascade decision pipeline (Phases 1, 3) |
| `src/detection/cyber-keyword-classifier.ts` | critical-tier split (Phase 2) |
| `src/storage/vendorInventory.ts` + `config/monitored-vendors.json` | news-volume field (Phase 3) |
| `src/review/eval/eval-page.ts` / `eval-routes.ts` | inventory tab field + layer-tagged failure buckets (Phase 3) |
| `src/evaluation/cheap-filter/*` | baseline-vs-cascade comparison support if needed (Phase 4) |
| `tests/*` | routing-table + invariant tests (Phase 3) |
| `docs/design/*`, `docs/code-reviews/*` | Phase 5 |
