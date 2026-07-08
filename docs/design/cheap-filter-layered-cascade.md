# Cheap-Filter Layered Cascade

Status: **implemented.** The operational reference is
[cheap-filter-rule-engine.md](cheap-filter-rule-engine.md); the keyword taxonomy it consumes is
governed by the [Cyber Threat Keyword Classification Standard](cyber-keyword-classification-standard.md).
This document records the design rationale for the three-layer gate cascade that replaced the flat
additive score as the decision mechanism.

---

## 1. Why the additive design leaks

`decideCheapFilter` pours every signal into one score bucket, and two signals bypass the score
entirely: `cves.length > 0 || keywords.critical.length > 0` is an outright KEEP (branch 1 of the
decision tree), with no vendor requirement. The additive design has no way to express *"cyber
keywords are only meaningful given a vendor match"* — relevance (is this about my vendors?) and
intensity (how scary does it sound?) are added together when one should be a precondition for the
other.

```
                      RSS title + summary
                              │
        ┌──────────┬──────────┼──────────┬───────────┐
        ▼          ▼          ▼          ▼           ▼
     CVE +50   vendor +50  keywords   source     categories
               product +65  +35/+20/+5  +10..25     +10
        │          │          │          │           │
        └──────────┴──────────┴──┬───────┴───────────┘
                                 ▼
                          one additive score
                                 │
   critical keyword? ────────────┼──────────────► KEEP   ⚠ no vendor needed
   CVE found? ───────────────────┘
                                 │
                        score ≥ 15 ──► MAYBE_KEEP        ⚠ trivially reachable
                                 │
                                 ▼
                               DROP
```

Observed failure modes (all present in the labelled eval set):

| Article | Additive outcome | Why it is wrong |
|---|---|---|
| "Hospital hit by ransomware" | KEEP (critical keyword) | Zero vendor relevance; pure noise for vendor-impact triage |
| "Zscaler announces product launch" | MAYBE_KEEP (vendor points ≥ 15) | Vendor PR without security context |
| "Microsoft reports quarterly earnings" | MAYBE_KEEP | Business news; weak keyword + vendor points clear the bar |

## 2. The cascade

Three layers with strict division of labor: **gates decide relevance, the score decides priority.**

```
                      RSS title + summary
                              │
              ╔═══════════════▼═══════════════╗
              ║ LAYER 1 · vendor/product gate ║
              ╚═══════════════╤═══════════════╝
                    match?    │
              yes ◄───────────┴───────────► no
               │                            │
               │              ┌─────────────▼──────────────┐
               │              │ severe-signal escape hatch │
               │              │  CVE in metadata? OR       │
               │              │  exploitation-class        │
               │              │  critical keyword          │
               │              │  (standard §4.1–4.2)? OR   │
               │              │  official_vendor /         │
               │              │  government_cert tier?     │
               │              └──────┬──────────────┬──────┘
               │                 yes │              │ no
               │                     ▼              ▼
               │              MAYBE_KEEP          DROP
               │              (capped —      "not my vendors,
               │               never KEEP)     not severe"
               ▼
   ╔═══════════════════════════════╗
   ║ LAYER 2 · cyber-context gate  ║
   ║ pass if: CVE in metadata      ║
   ║  OR critical keyword          ║
   ║  OR medium keyword + (security║
   ║     RSS category | security-  ║
   ║     media | researcher tier)  ║
   ║  OR official_vendor /         ║
   ║     government_cert tier      ║
   ║ veto: negative keywords       ║
   ║  dominate (standard §7)       ║
   ║ strictness modulated per      ║
   ║  vendor news volume (§4)      ║
   ╚═══════════════╤═══════════════╝
          pass ◄───┴───► fail ──────────────► DROP
           │                             "vendor PR / business
           ▼                              news killer"
   ╔═══════════════════════════════╗
   ║ LAYER 3 · priority score      ║
   ║ source tier + keyword tier +  ║
   ║ product-vs-vendor specificity ║
   ║ + recency + categories        ║
   ║ (one input among five)        ║
   ╚═══════════════╤═══════════════╝
                   │
        high ◄─────┴─────► low
          │                 │
          ▼                 ▼
        KEEP           MAYBE_KEEP
```

### Layer 1 — vendor/product gate with a severe-signal escape hatch

The cheap filter sees only RSS title + summary, never the article body. Headlines that matter
often omit the vendor there ("Actively exploited zero-day in popular PAM solution", CVE-only CERT
titles, log4j-style component stories). A hard vendor gate would drop these before extraction —
and a false DROP is invisible and unrecoverable, while a false MAYBE_KEEP costs one low-priority
extraction plus one LLM call. That asymmetry is the design's first principle.

So: no vendor match does not terminate immediately. A narrow escape hatch checks for *severe*
signals only — a CVE ID, an exploitation-class critical keyword (standard §4.1 active exploitation
/ §4.2 zero-day-emergency, deliberately **not** §4.4 incident or §4.5 malware-campaign classes), or
an `official_vendor` / `government_cert` source tier. Hatch pass → MAYBE_KEEP, permanently capped
(Layer 3 cannot promote it to KEEP); the LLM classifier downstream makes the real call. Hatch fail
→ DROP. "Hospital hit by ransomware" fails the hatch: `ransomware` is incident-class, there is no
CVE, and security media is not a trusted-enough tier to bypass a missing vendor.

### Layer 2 — cyber-context gate

Reached only with a vendor/product match in hand. Terminates vendor PR and business news — the
"Zscaler product launch" and "Microsoft earnings" failures. Three refinements over a naive
keyword check:

- **A CVE in the metadata satisfies the gate outright** — a CVE is inherently security context,
  even with zero keywords matched.
- **Keyword tiers matter.** A critical keyword passes alone; a medium keyword needs corroboration
  (security RSS category, or security-media/researcher source tier); low keywords never pass this
  gate by themselves.
- **Negative-keyword veto.** Negative dominance (standard §7: earnings, launch, partnership,
  appoints…) fails the gate even when a weak keyword appears in passing.

### Layer 3 — priority score

Only reached after both gates pass, and only chooses the band: KEEP vs MAYBE_KEEP. Inputs: source
tier, keyword tier strength, product-name vs vendor-name specificity (product match outranks
vendor-only, per standard §10.5), recency, RSS categories. Categories are deliberately one input
among five, not the sole scorer — category quality varies wildly per feed and many are empty or
junk taxonomy.

## 3. Invariants

1. **The score never resurrects a gated article.** DROP at Layer 1 or 2 is final within the cheap
   filter.
2. **The score never drops an article that passed both gates.** Worst case after the gates is
   MAYBE_KEEP (low-priority extraction).
3. **Escape-hatch articles are capped at MAYBE_KEEP.** Vendor-less severe signals get extracted
   and judged by the LLM; they never KEEP on RSS metadata alone.
4. **Every termination names its layer.** Blocking reasons carry the layer that terminated
   (`cheap_filter_l1_*`, `cheap_filter_l2_*`), so the eval report's failure buckets answer "which
   gate is eating my recall" directly.
5. **The `FilterDecision` interface is unchanged** (decision / score / reasons / blockingReasons /
   matchedSignals), so the eval harness, dashboards, and downstream stages need no migration.

## 4. Per-vendor gate strictness

"Microsoft" matching is nothing like "CyberArk" matching — the monitored inventory deliberately
spans quiet-critical to noisy-high-volume. Instead of the hardcoded `NOISY_VENDOR_NAMES` score
penalty, gate strictness is modulated per vendor from inventory metadata:

| Vendor news volume | Layer 2 requirement |
|---|---|
| noisy (e.g. Microsoft) | CVE, or critical keyword, or medium keyword **with** corroboration |
| quiet (e.g. CyberArk) | CVE, or critical keyword, or medium keyword alone |

This inverts the current behavior for the quiet-critical case on purpose: a medium keyword next to
a CyberArk PAS mention is exactly the early-warning signal the 2-hour SLO exists for.

## 5. Worked routing table

```
 Article                              L1 vendor    L2 cyber    L3 score → result
 ─────────────────────────────────    ──────────   ─────────   ─────────────────
 "Zscaler announces product launch"   ✓ pass       ✗ TERMINATE            DROP
 "Microsoft quarterly earnings"       ✓ pass       ✗ veto                 DROP
 "Hospital hit by ransomware"         ✗ no hatch   ·                      DROP
 "Zero-day in popular PAM solution"   ✗ HATCH →    ·               MAYBE_KEEP
 "CVE-2026-X added to KEV"            ✗ HATCH →    ·               MAYBE_KEEP
 "CyberArk PAS auth bypass exploited" ✓ pass       ✓ pass      high →   KEEP
 "MS Patch Tuesday (security media)"  ✓ pass       ✓ pass      mid → MAYBE_KEEP
```

## 6. Relationship to the evaluation gate

The cascade ships only through the cheap-filter eval harness (`npm run eval:cheap-filter`), and the
labelled dataset must first grow past its current 15 samples — the report itself flags recall
thresholds as statistically weak below 50. Acceptance is defined in the implementation plan:
critical recall holds at 100%, relevant recall holds, pass-through and irrelevant-pass rates fall.
Intuition does not decide whether this design replaces the additive engine; the gate does.
