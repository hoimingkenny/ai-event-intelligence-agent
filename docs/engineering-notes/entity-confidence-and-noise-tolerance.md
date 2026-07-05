# Tolerating Imperfect Extraction: Confidence-Scored Entities

Perfect text extraction is unattainable — residual boilerplate (footer "Related: Microsoft patches…" links, native-ad copy, "you may also like" headlines) will always leak some vendor and product mentions into `cleanText`. This note records the shift from treating clean text as a *precondition* for entity extraction to treating noise as a *tolerated input* that gets down-weighted and gated. The principle: never depend on a preceding stage being perfect when the failure is recoverable by scoring instead.

## 1. The failure mode

Entity extraction was deterministic dictionary/regex matching (vendor inventory, CVE pattern, IOC patterns, keyword list) over a *flattened* `title + rssSummary + cleanText` string, with every match emitted as an equal-weight entity. Consequence: a Linux article whose footer carries a "Related: Microsoft Exchange zero-day" link produces a `vendor: Microsoft` entity indistinguishable from a real one. That false entity then drives the event grouping key, becomes an `affected_vendor`, and can fire a false vendor-impact alert — the single most damaging leak for this product, because it manufactures alerts about vendors the article is not even about.

Two families of fix exist: (A) make the input cleaner, (B) make the extractor tolerant of residual noise. Cleaning was already pushed hard (per-source selectors, DOM pruning, ad-cluster removal), and it is asymptotic — you never reach 100%. So the durable fix is B, backed by (C) a gate that makes leaks harmless even when they occur.

## 2. Family B — the extractor is born noise-aware

Every entity now carries a confidence derived from *where* and *how* it appears, computed by the pure module `src/detection/entity-confidence.ts`.

**Zoned placement.** The article is split into weighted zones — `title` (1.0), `summary` (0.9), `lead` first ~500 chars (0.8), `body` middle (0.6), `tail` last ~400 chars (0.3). The tail weight is deliberately low: related-article lists and footers concentrate there. An entity's base score is the strongest zone it appears in. This required passing the article's fields *separately* into the extractor — a pre-flattened string discards exactly the positional signal that makes noise weak.

**Frequency.** A repeated mention (`occurrences ≥ 2`) gets a small bonus; a real subject tends to recur, a footer link appears once.

**Corroboration.** A vendor/product co-occurring with cyber keywords or a CVE is about a security event; a lone vendor name with no nearby exploit language is capped at 0.45 — the classic false positive is born weak by construction.

**Structural identifiers stay high.** CVEs and IOCs are precise by format (`CVE-2026-1234` is not accidentally a CVE), so they score ~0.95 regardless of corroboration — with a reduction if they *only* appear in the tail.

The result: a title vendor with security context lands ≥ 0.9; a footer "Related: Zscaler" mention lands < 0.5.

## 3. Family C — make leaks harmless, and cross-check the dumb signal

**Event-boundary gate.** `buildEventDraft` now filters entities by `MIN_EVENT_ENTITY_CONFIDENCE` (0.5): only trusted entities drive affected vendors/products, CVEs, and the grouping key. A low-confidence entity is still stored on the article (for audit and review) but cannot manufacture an event or alert. This is the key move — it converts "clean text is required" into "noise is tolerated at extraction and gated at the event boundary."

**LLM cross-check.** The classifier already returns `vendorRoles` (vendor + role + rationale). `crossCheckVendorConfidence` reconciles the confident-but-dumb deterministic signal against the smart one: a regex-matched vendor the LLM judges `unrelated`/`unknown` is multiplied down (×0.4); one it affirms as `affected` (etc.) is boosted (+0.2). Contradictions are recorded in the LLM audit log (`contradictedVendors`), so a deterministic vendor the LLM disagrees with is *observable* in the review dashboard, not silently trusted. This is the same "cross-check LLM verdict against deterministic signal" pattern used for prompt-injection defense, applied in the other direction.

## 4. Why this ordering is correct

The instinct to "fix the entity stage by cleaning the text more" is a trap: it chases an unreachable 100% and leaves the system brittle to the noise that inevitably survives. Scoring + gating is robust to *any* residual noise, including new leak shapes from future site redesigns that the cleaner has never seen. The extraction cleaner and the confidence gate are defense in depth — the cleaner reduces how much noise arrives, the gate ensures whatever arrives cannot cause harm.

It is also measurable. The human-review dashboard already captures a `vendor_impact` verdict per article — that *is* the false-entity signal. Once verdicts export into the eval set, entity precision becomes a tracked number, and the confidence thresholds (zone weights, 0.45 cap, 0.5 gate) move from priors to calibrated values. Until then they are honest defaults with unit tests pinning the behaviour.

## 5. Transferable lesson

When stage N depends on stage N-1's output being clean, ask whether the dependency can be softened from *precondition* to *weighted input*. If a wrong output from N-1 is recoverable — as a false entity is, by scoring and gating — do not invest in making N-1 perfect; invest in making N tolerant. Perfection is asymptotic and fragile; tolerance is bounded and durable.

## File index

| File | Role |
|---|---|
| `src/detection/entity-confidence.ts` | Pure scoring: zones, frequency, corroboration, LLM cross-check |
| `src/detection/entity-extractor.ts` | Emits entities with confidence; takes fields separately for zoning |
| `src/pipeline/entity-stage.ts` | Passes title/summary/body separately |
| `src/events/event-grouper.ts` | `MIN_EVENT_ENTITY_CONFIDENCE` gate on event-driving entities |
| `src/pipeline/classification-stage.ts` | LLM vendorRole reconciliation + contradiction audit |
| `tests/entity-confidence.test.ts` | Scoring, zoning, cross-check unit tests |
