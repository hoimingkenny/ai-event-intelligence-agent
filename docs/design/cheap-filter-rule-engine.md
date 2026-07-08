# Cheap-Filter Rule Engine (implemented)

This document describes the cheap filter as implemented in `src/pipeline/filter-stage.ts`.
The cheap filter is deterministic: no LLM calls, no article-body access, and no database reads
inside `decideCheapFilter()`. Its input is RSS metadata only: title, RSS summary, RSS categories,
source name/tier, and publication time.

## Output Contract

The `FilterDecision` shape is unchanged:

```ts
{
  decision: 'KEEP' | 'MAYBE_KEEP' | 'DROP',
  score: number,                 // 0-100, normalized
  reasons: string[],
  blockingReasons: string[],
  matchedSignals: {
    criticalCyberKeywords: string[],
    mediumCyberKeywords: string[],
    lowCyberKeywords: string[],
    negativeKeywords: string[],
    cves: string[],
    vendors: string[],
    products: string[],
    rssCategories: string[],
    sourceTier: SourceTier,
  },
  shouldExtract: boolean,
  cves: string[],
  vendors: string[],
  products: string[],
}
```

Downstream status mapping is also unchanged:

```text
KEEP       -> EXTRACTION_PENDING
MAYBE_KEEP -> EXTRACTION_PENDING_LOW_PRIORITY
DROP       -> IGNORED
```

## Signal Extraction

`collectCheapFilterSignals()` builds one text corpus from:

```text
title + rssSummary + rssCategories
```

It extracts:

- CVEs via `extractCves()`
- monitored vendor/product matches via `detectVendorsFromInventory()`
- cyber keywords via `detectCategorizedCyberKeywords()`
- source tier via provided `sourceTier` or `inferSourceTier(sourceName)`
- security RSS categories via a fixed allow-list
- matched inventory rows, including each product's `newsVolume`

## Keyword Taxonomy

The classifier still exposes `critical`, `medium`, `low`, and `negative` arrays, but critical
keywords are now split internally:

- `criticalExploitation`: active exploitation, KEV, zero-day/emergency patch, RCE/auth bypass,
  privilege escalation.
- `criticalIncident`: ransomware, breach/leak, compromise, backdoor, supply-chain attack,
  account takeover.

The combined `critical` array is still recorded in `matchedSignals.criticalCyberKeywords` for
backward compatibility.

## Layer 1: Vendor/Product Gate

If a monitored vendor or product is present, the article proceeds to Layer 2.

If no monitored vendor/product is present, a narrow escape hatch checks for severe RSS metadata:

- CVE present, or
- exploitation-class critical keyword present, or
- `official_vendor` / `government_cert` source tier.

Escape-hatch articles return `MAYBE_KEEP` and are capped below the Layer-3 KEEP threshold. They
are extracted for downstream LLM review, but the cheap filter never promotes vendorless severe
signals to `KEEP`.

If the hatch fails, the article returns `DROP` with:

```text
cheap_filter_l1_no_vendor_no_severe_signal
```

## Layer 2: Cyber-Context Gate

Reached only after a vendor/product match. This layer decides whether the vendor mention is
security-relevant.

Pass conditions:

- CVE present
- any critical keyword present
- official vendor or government/CERT source tier
- medium keyword that satisfies vendor strictness

Vendor strictness comes from `config/monitored-vendors.json`:

| `newsVolume` | Medium keyword rule |
|---|---|
| `quiet` | medium keyword alone may pass |
| `noisy` | medium keyword needs corroboration from security RSS category, security media, or researcher blog |

Negative business/marketing context vetoes Layer 2 when there is no CVE or critical keyword.
The main terminating reasons are:

```text
cheap_filter_l2_no_cyber_context
cheap_filter_l2_negative_dominance
```

Existing compatibility reasons are still emitted where applicable, such as
`cheap_filter_negative_business_context`, `cheap_filter_vendor_only_without_security_context`,
and `cheap_filter_insufficient_rss_signal`.

## Layer 3: Priority Score

Only articles that pass both gates reach priority scoring. The score chooses `KEEP` vs
`MAYBE_KEEP`; it cannot resurrect a DROP and cannot demote a gate-passing article below
`MAYBE_KEEP`.

Score inputs:

| Signal | Contribution |
|---|---:|
| CVE present | +35 |
| monitored product | +25 |
| monitored vendor only | +15 |
| exploitation-class critical keyword | +35 |
| incident-class critical keyword | +25 |
| medium keyword | +20 |
| low keyword combination | +10 |
| any low keyword | +5 |
| official vendor / government source | +25 |
| security media / researcher blog | +10 |
| security RSS category | +10 |
| recent article, within 24h | +10 |
| negative keyword | -20 |
| stale article, older than 14 days | -20 |

The score is normalized to 0-100. Current threshold:

```text
score >= 50 -> KEEP
score < 50  -> MAYBE_KEEP
```

## Invariants

1. A Layer-1 or Layer-2 DROP is final.
2. A double-gate pass is never dropped by score.
3. Vendorless escape-hatch articles never become KEEP.
4. Terminating gate reasons identify the layer.
5. The persisted `FilterDecision` interface is unchanged.
