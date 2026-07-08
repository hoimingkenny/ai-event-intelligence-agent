# Cheap-Filter Rule Engine (implemented)

This document describes the **rule engine as it is implemented in code today**, not the design intent. The design intent lives in [Cyber Threat Keyword Classification Standard](cyber-keyword-classification-standard.md) — that is the *what should be*. This file is the *what is* — the specific scoring values, predicates, and decision tree that `decideCheapFilter` actually executes.

When the two diverge, the implementation wins (because the gate runs against this code), and the standard should be updated to match. The Deviations section at the bottom flags every known gap.

---

## 1. Where it lives

| Concern | File | Symbol |
|---|---|---|
| Decision function (pure) | `src/pipeline/filter-stage.ts` | `decideCheapFilter()` (lines 72–204) |
| Stage runner (I/O) | `src/pipeline/filter-stage.ts` | `runCheapFilterStage()` (lines 206–238) |
| Source tier inference | `src/pipeline/filter-stage.ts` | `inferSourceTier()` (lines 240–258) |
| Keyword classifier | `src/detection/cyber-keyword-classifier.ts` | `detectCategorizedCyberKeywords()` (lines 174–181) |
| Vendor / product / alias detector | `src/detection/vendor-detector.ts` | `detectVendorsFromInventory()` (lines 9–44) |
| CVE regex | `src/detection/cve-extractor.ts` | `extractCves()` — `\bCVE-\d{4}-\d{4,}\b` |
| Live vendor inventory | `src/storage/vendorInventory.ts` | `monitoredVendors` (hot-reloaded array) |

The engine is a single pure function — `decideCheapFilter(input) → FilterDecision` — composed of signal extractors, a fixed score table, three helper predicates, and a five-branch decision tree.

---

## 2. Inputs and output

### Input: `CheapFilterInput` (`filter-stage.ts:48–52`)

```ts
type CheapFilterInput = Pick<ArticleRecord, 'title' | 'rssSummary'> &
  Partial<Pick<ArticleRecord, 'sourceName' | 'publishedAt'>> & {
    rssCategories?: string[];
    sourceTier?: SourceTier;
  };
```

The text corpus for matching is built by joining (`filter-stage.ts:73–75`):

```text
title + '\n' + rssSummary + ('\n' + rssCategory)*
```

`rssCategories` is the `articles.rss_categories TEXT[]` column (migration 012). `sourceTier` is taken verbatim if provided, otherwise inferred from `sourceName` via string match (see §6).

### Output: `FilterDecision` (`filter-stage.ts:29–39`)

```ts
{
  decision: 'KEEP' | 'MAYBE_KEEP' | 'DROP',
  score: number,                                  // 0–100, normalized
  reasons: string[],                              // positive contributions (Set → Array)
  blockingReasons: string[],                      // deficits that lowered the decision
  matchedSignals: {
    criticalCyberKeywords: string[],
    mediumCyberKeywords: string[],
    lowCyberKeywords: string[],
    negativeKeywords: string[],
    cves: string[],
    vendors: string[],
    products: string[],
    rssCategories: string[],                      // security-only subset
    sourceTier: SourceTier,
  },
  shouldExtract: boolean,                         // decision !== 'DROP'
  cves, vendors, products,                        // top-level convenience copy
}
```

The same shape is persisted to `articles.cheap_filter_decision | _score | _reasons | _blocking_reasons | _matched_signals` (migration 011) by `ArticleRepository.saveCheapFilterResult`.

---

## 3. Signal extractors

All five run against the same joined text. None of them are LLM calls — all are deterministic string/regex matches.

### 3.1 Keyword classifier (`cyber-keyword-classifier.ts`)

Four categories, each matched as exact phrase, case-insensitive, with word-boundary regex `(^|[^a-z0-9])PHRASE([^a-z0-9]|$)` (lines 197–200). Before matching, both text and phrase are run through `normalizeForMatching()` (lines 188–195): lowercase, unicode dashes → `-`, then `[-_/]+` → space, whitespace collapsed. So `-` / `_` / `/` and spaces are interchangeable for matching.

The classifier returns matches *in declared-list order* with duplicates preserved; duplicates in the output are possible if multiple phrases normalize to the same string.

The literal keyword lists in the code are a strict subset of the standard's lists. Specifically missing from the implementation but present in the standard include `weaponised exploit` (line — wait, both spellings are present), `out-of-band patch` (present), `hotfix` (absent), `0-day` (present), `path traversal` (present), `XXE` (absent), `CSRF` (absent), `MITRE ATT&CK` (absent), `BEC` (absent), `lpe` (absent), `rce` is present as a substring of `remote code execution` and on its own.

### 3.2 Vendor / product / alias detector (`vendor-detector.ts`)

Iterates `monitoredVendors` (the in-memory array backed by `config/monitored-vendors.json` and hot-reloaded by `saveMonitoredVendors`). For each entry:

- If any of `vendor + aliases[*]` matches the text → add vendor + alias.
- If `product` matches the text → add vendor + product + alias.
- For each alias that matches → add vendor + product + alias.

Match uses the same `containsPhrase` regex (word-boundary, case-insensitive). The result is the union set over the inventory.

### 3.3 CVE extractor (`cve-extractor.ts`)

Regex `\bCVE-\d{4}-\d{4,}\b`. All matches returned, deduplicated only by the caller's downstream code (none in the engine).

### 3.4 Source tier (`filter-stage.ts:240–258`)

See §6 below — six-tier classification by `sourceName` substring match.

### 3.5 Security RSS category filter (`filter-stage.ts:260–265`)

The raw `rssCategories` array is filtered to entries whose lowercase form `.includes()` any of these substrings:

```text
security, cybersecurity, vulnerability, vulnerabilities, malware,
ransomware, zero day, zero-day, data breach, threat intelligence,
security advisory, patch, incident
```

Anything else is dropped before scoring and before being recorded in `matchedSignals.rssCategories`.

---

## 4. Score table

Every positive contribution is applied via the local `addScore(reason, value)` closure (`filter-stage.ts:182–185`), which both adds to `score` and inserts the `reason` string into the `reasons` Set. Negative contributions use plain `score -= N`. The score is clamped to `[0, 100]` at the end (`normalizeScore`, line 303).

### 4.1 Positive contributions

| Reason code | Value | Condition (`filter-stage.ts` line) |
|---|---:|---|
| `cve_found` | +50 | `cves.length > 0` (85) |
| `monitored_product_found` | +65 | `vendors.products.length > 0` (86) |
| `monitored_vendor_found` | +50 | `vendors.vendors.length > 0` (87) |
| `critical_cyber_keyword_found` | +35 | `keywords.critical.length > 0` (88) |
| `medium_cyber_keyword_found` | +20 | `keywords.medium.length > 0` (89) |
| `low_cyber_keyword_found` | +5 | `keywords.low.length > 0` (90) |
| `official_vendor_source` | +25 | `sourceTier === 'official_vendor'` (91) |
| `government_cert_source` | +25 | `sourceTier === 'government_cert'` (92) |
| `security_media_source` | +10 | `sourceTier === 'security_media'` (93) |
| `researcher_blog_source` | +10 | `sourceTier === 'researcher_blog'` (94) |
| `security_rss_category_found` | +10 | `securityCategories.length > 0` (95) |
| `recent_article` | +10 | `isRecent(article.publishedAt)` — within 24h (96, 267–270) |

Each row contributes *at most once*. Two CVEs still give +50, not +100.

### 4.2 Negative contributions

| Reason | Value | Condition (`filter-stage.ts` line) |
|---|---:|---|
| Negative business keywords present | −20 | `keywords.negative.length > 0` (98–101). Adds blocking reason `cheap_filter_negative_business_context`. |
| Stale article | −20 | `isOld(article.publishedAt)` — older than 14 days (143–146). Adds blocking reason `cheap_filter_old_or_stale_article`. |
| Noisy vendor only, no security context | −20 | `isVendorOnlyWithoutSecurityContext` AND vendor is in `NOISY_VENDOR_NAMES` (138–140). Adds blocking reason `cheap_filter_vendor_only_without_security_context`. |

Note: the −20 for stale articles applies regardless of other signals. The −20 for negative keywords always lowers the score but does not by itself force a DROP — that depends on the decision tree (§5). The −20 for noisy vendor-only applies only when the matched vendor is in the noisy list and there is no cyber context at all.

---

## 5. Helper predicates

These are computed once near the top of the function and reused across reason flags, blocking reasons, and the decision tree.

### `hasCyberContext` (`filter-stage.ts:103–110`)

True iff any of:

```text
cves.length > 0
keywords.critical.length > 0
keywords.medium.length > 0
securityCategories.length > 0
sourceTier ∈ {official_vendor, government_cert, security_media}
```

Used by `product_with_cyber_context` and `vendor_with_cyber_context` reason flags (118–119), and by the KEEP branch's `vendors.products.length > 0 && hasCyberContext` condition.

### `hasStrongPositiveSignal` (`filter-stage.ts:111–116`)

True iff any of:

```text
cves.length > 0
keywords.critical.length > 0
vendors.products.length > 0
sourceTier ∈ {official_vendor, government_cert}
```

A *strict* subset of `hasCyberContext` — notably excludes medium keywords, security RSS categories, and security_media tier. Used by the second-tier decision branch (`score >= 40 && hasStrongPositiveSignal`) and by `hasNegativeDominance` (which only suppresses negatives when there is no strong positive).

### `hasNegativeDominance` (`filter-stage.ts:285–287`)

True iff `keywords.negative.length > 0 && !hasStrongPositiveSignal`. Used in the second-tier branch (158) to demote KEEP to MAYBE_KEEP when the only thing the article has going for it is weak positive signals and it carries a negative business context.

### `hasLowCombination(lowKeywords)` (`filter-stage.ts:289–301`)

True iff the article matches **one of these eight exact pairs** (case-insensitive, after the same normalization the classifier uses):

```text
identity + attack
cloud + vulnerability
authentication + bypass
admin + compromise
api + exposure
account + takeover
password + leak
login + bypass
```

Used as an OR-gate alongside `score >= 15` to push an article into MAYBE_KEEP from the third decision branch. Note: `bypass`, `attack`, `vulnerability`, `compromise`, `exposure`, `takeover`, `leak` are all low keywords — none is critical or medium — so these combinations carry no critical or medium context of their own.

### `isVendorOnlyWithoutSecurityContext` (`filter-stage.ts:277–283`)

True iff `vendors.length > 0 && products.length === 0 && !hasCyberContext`. Returns true even if the article carries medium keywords but no product/CVE/critical — because `hasCyberContext` here is the *strict* list, so a medium-keyword-only article without security RSS category and from a non-trusted source qualifies.

### `isRecent` / `isOld` (`filter-stage.ts:267–275`)

- `isRecent`: `publishedAt` exists and is within the last 24h.
- `isOld`: `publishedAt` exists and is older than 14 days.

Both return `false` for missing/null timestamps. This means a *missing* `publishedAt` triggers neither the recency bonus nor the stale penalty.

### `securityRssCategories` (`filter-stage.ts:260–265`)

Filters raw `rssCategories` to entries whose lowercase form `.includes()` any of the 13 substrings listed in §3.5. The full set is also stored on `matchedSignals.rssCategories`.

---

## 6. Source tier inference (`filter-stage.ts:240–258`)

Tier is matched by `sourceName.toLowerCase().includes(...)`. First match wins; order is significant.

| Tier | Substring match | Examples |
|---|---|---|
| `government_cert` | `cisa` or `cert` | CISA, US-CERT |
| `official_vendor` | `psirt`, `msrc`, or `security advisories` | MSRC, CyberArk PSIRT, "Zscaler Security Advisories" feed name |
| `security_media` | `bleeping`, `hacker news`, `krebs`, `securityweek`, or `dark reading` | BleepingComputer, The Hacker News, KrebsOnSecurity, SecurityWeek, Dark Reading |
| `researcher_blog` | `blog` or `research` | Project Zero, vendor blogs (catch-all after the higher tiers) |
| `general_news` | `business` or `news` | Reuters, BBC, business wires |
| `unknown` | (fallback) | anything else |

Two consequences worth knowing:

1. **Vendor blog feeds that match `blog` may be classified as `researcher_blog`, not `official_vendor`** — unless their feed name also contains `psirt` / `msrc` / `security advisories`. The standard expects `Cloudflare Security Blog` to be `official_vendor`; here it is `researcher_blog`. If this matters, set the explicit `sourceTier` on the article before it reaches the stage.
2. **The CyberArk blog feed is currently `official_vendor`** because the feed name contains `security advisories` per `config/rssFeeds.ts`. If the feed name is ever changed to drop that phrase, it will fall to `researcher_blog`.

---

## 7. Always-on blocking reasons

These are emitted regardless of decision (`filter-stage.ts:127–134`). They describe what is *missing*, not what caused the drop.

| Blocking reason | Condition |
|---|---|
| `cheap_filter_no_cve_in_rss_metadata` | `cves.length === 0` |
| `cheap_filter_no_vendor_product_in_rss_metadata` | `vendors.vendors.length === 0 && vendors.products.length === 0` |
| `cheap_filter_no_cyber_keyword_in_rss_metadata` | `keywords.critical.length === 0 && keywords.medium.length === 0 && keywords.low.length === 0` |
| `cheap_filter_general_news_source` | `sourceTier === 'general_news'` |

Plus these conditional ones:

| Blocking reason | Condition |
|---|---|
| `cheap_filter_negative_business_context` | `keywords.negative.length > 0` |
| `cheap_filter_vendor_only_without_security_context` | `isVendorOnlyWithoutSecurityContext(...)` |
| `cheap_filter_old_or_stale_article` | `isOld(article.publishedAt)` |
| `cheap_filter_insufficient_rss_signal` | `decision === 'DROP'` |
| `cheap_filter_low_score` | `decision === 'DROP' && score < 15` |

---

## 8. Decision tree

The branches are evaluated in order; first match wins (`filter-stage.ts:149–163`).

### Branch 1 — hard KEEP

```text
if (cves.length > 0
 || keywords.critical.length > 0
 || (vendors.products.length > 0 && hasCyberContext))
  → KEEP
```

Three triggers:

- any CVE in the RSS metadata
- any critical keyword
- a monitored product matched *with* any cyber context (CVE / critical keyword / medium keyword / security RSS category / trusted-tier source)

Note: a monitored product alone (no cyber context) does **not** reach this branch — it falls into branches 2 or 3.

### Branch 2 — soft KEEP (with negative-keyword demotion)

```text
else if (sourceTier === 'official_vendor'
      || sourceTier === 'government_cert'
      || (vendors.vendors.length > 0 && keywords.medium.length > 0)
      || (score >= 40 && hasStrongPositiveSignal))
  → hasNegativeDominance(...) ? MAYBE_KEEP : KEEP
```

Four entry conditions:

- `official_vendor` source tier (any text)
- `government_cert` source tier (any text)
- monitored vendor match + at least one medium keyword
- score ≥ 40 **and** a strong positive signal (CVE / critical / product / trusted tier)

If any of those holds, the article becomes KEEP — *unless* `hasNegativeDominance` is true (negatives present, no strong positive signal), in which case it is demoted to MAYBE_KEEP. A `researcher_blog` or `security_media` source with high score but only medium keywords will not enter this branch because `hasStrongPositiveSignal` excludes medium keywords.

### Branch 3 — MAYBE_KEEP

```text
else if (score >= 15 || hasLowCombination(keywords.low))
  → MAYBE_KEEP
```

Either an aggregate score of 15+, or one of the eight explicit low-keyword pairs from `hasLowCombination`.

### Branch 4 — DROP

```text
else → DROP
```

The function then unconditionally adds `cheap_filter_insufficient_rss_signal` to `blockingReasons` (166), and `cheap_filter_low_score` if `score < 15` (167). If both `reasons` and `blockingReasons` ended up empty (which only happens for an empty-text input), it falls back to `cheap_filter_insufficient_rss_signal` (189–191).

### Status mapping (`runCheapFilterStage`, lines 220–228)

| Decision | New `processing_status` | `processing_error` |
|---|---|---|
| `KEEP` | `EXTRACTION_PENDING` | (unchanged) |
| `MAYBE_KEEP` | `EXTRACTION_PENDING_LOW_PRIORITY` | (unchanged) |
| `DROP` | `IGNORED` | `blockingReasons.join(',')` |

---

## 9. Worked traces

These mirror the standard's worked examples against the actual implementation.

### Example A — Fortinet advisory from BleepingComputer

```text
Title:  Fortinet warns of actively exploited FortiOS vulnerability
Summary: Customers are urged to patch immediately.
Source:  BleepingComputer
```

Signals:

- `cves` = []
- `vendors` = [Fortinet] (alias match); `products` = [FortiOS] — *only if* FortiOS / FortiGate are listed as products or aliases in the live inventory. Otherwise vendor-only.
- `keywords.critical` = ['actively exploited']
- `keywords.medium` = ['vulnerability']
- `securityCategories` = []
- `sourceTier` = `security_media` (contains 'bleeping')

Decision:

- Branch 1 fires (`keywords.critical.length > 0`) → **KEEP**.
- Score ≈ +65 (product) +35 (critical) +20 (medium) +10 (security_media) = 130 → clamped to 100.

### Example B — Identity-platform flaw from BleepingComputer

```text
Title:  Critical flaw discovered in enterprise identity platform
Summary: Researchers say attackers may gain unauthorized access.
Source:  BleepingComputer
```

Signals:

- `cves` = []
- `vendors` = []; `products` = []
- `keywords.critical` = [] ('critical' alone is a low keyword in the classifier — see deviations)
- `keywords.medium` = ['flaw']
- `sourceTier` = `security_media`

Decision:

- Branch 1: false (no CVE, no critical keyword, no monitored product).
- Branch 2: false (source is `security_media`, not `official_vendor` / `government_cert`; no monitored vendor; `score = +20 +10 = 30`, but `hasStrongPositiveSignal` is false).
- Branch 3: `score >= 15` true → **MAYBE_KEEP**.
- Blocking reasons: `cheap_filter_no_cve_in_rss_metadata`, `cheap_filter_no_vendor_product_in_rss_metadata`, `cheap_filter_no_cyber_keyword_in_rss_metadata` (medium does not include 'cyber keyword' in this predicate — see §10 below).

### Example C — Microsoft 365 AI launch from general news

```text
Title:  Microsoft announces new AI features for enterprise customers
Summary: New productivity tools are coming to Microsoft 365.
Source:  Reuters
```

Signals:

- `cves` = []
- `vendors` = [Microsoft]; `products` = []
- `keywords.critical` = []
- `keywords.medium` = []
- `keywords.low` = [] (none of 'new feature', 'productivity' etc. are in the low list)
- `keywords.negative` = ['new feature']
- `sourceTier` = `general_news` (contains 'news')

Decision:

- Branch 1: false.
- Branch 2: false (Microsoft is in NOISY_VENDOR_NAMES, but `hasCyberContext` is false — also no trusted tier, no medium keyword, score = 0).
- Branch 3: false (`score = -20 - 20 = -40 → 0`, no low-keyword combination).
- Branch 4: **DROP**.
- Score after `normalizeScore` = 0.
- Blocking reasons: `cheap_filter_no_cve_in_rss_metadata`, `cheap_filter_no_vendor_product_in_rss_metadata`, `cheap_filter_no_cyber_keyword_in_rss_metadata`, `cheap_filter_general_news_source`, `cheap_filter_negative_business_context`, `cheap_filter_vendor_only_without_security_context`, `cheap_filter_insufficient_rss_signal`, `cheap_filter_low_score`.

### Example D — Microsoft Patch Tuesday from security media

```text
Title:  Microsoft Patch Tuesday fixes 120 security vulnerabilities
Source:  BleepingComputer
```

Signals:

- `cves` = []
- `vendors` = [Microsoft]; `products` = []
- `keywords.medium` = ['vulnerabilities', 'security vulnerabilities' (substring), 'patch tuesday'] — note 'security' is low, not medium
- `sourceTier` = `security_media`

Decision:

- Branch 1: false.
- Branch 2: triggers on `(vendors.vendors.length > 0 && keywords.medium.length > 0)` → KEEP (no negatives).
- Score: +50 (vendor) +20 (medium) +10 (security_media) = 80 → 80.

This relies on the *exact* rule `(vendor && medium) → KEEP` to bypass the noisy-vendor-only penalty. If the medium keyword were absent (e.g. title only says "Patch Tuesday"), `hasLowCombination(['patch', 'tuesday'])` would not fire either because the pairs don't include that combination.

### Example E — CISA adds CVE to KEV

```text
Title:  CISA adds new vulnerability to known exploited catalog
Source:  CISA
```

Signals:

- `vendors` = []; `products` = []
- `keywords.critical` = ['known exploited vulnerabilities catalog'] (matches the literal phrase)
- `sourceTier` = `government_cert`

Decision:

- Branch 1 fires (`keywords.critical.length > 0`) → **KEEP**.
- Score: +35 +25 = 60 → 60.

---

## 10. Deviations from the standard

These are places where the implementation disagrees with [Cyber Threat Keyword Classification Standard](cyber-keyword-classification-standard.md). Each deviation is a candidate for either a code change or a doc update — the standard is the *intent*, the code is the *gate*.

| # | Deviation | Standard says | Implementation does |
|---|---|---|---|
| 1 | §3 score thresholds (`>=40` KEEP, `15–39` MAYBE, `<15` DROP) | Hard thresholds | Used as a soft condition *behind* Branch 1 / Branch 2's structural triggers. Branch 1 ignores score entirely. |
| 2 | §4.1 / §4.2 phrases | `out-of-band patch`, `hotfix`, `0-day`, `MITRE ATT&CK`, `BEC`, `LPE`, `WAF bypass` etc. | Many phrases from §4 absent from `cyber-keyword-classifier.ts`. The classifier is a *subset*. |
| 3 | §9 context rules for `exploit` / `breach` / `attack` / `patch` | Context-aware scoring: business-context `breach` is Negative; `attack` without cyber context is Low | Implemented purely via substring matching + the negative-keyword list. `breach of contract` is Negative; `breach` alone is Critical. No context-aware scoring for `exploit` or `attack`. |
| 4 | §11 noisy vendor policy | `vendor + cyber signal = KEEP`, `vendor only + general = MAYBE_KEEP/DROP` | Same intent, but `hasCyberContext` includes medium keywords and security RSS categories — so a noisy vendor + medium keyword bypasses the −20 penalty via Branch 2. |
| 5 | §12 source tier rules | Vendor security blogs are `official_vendor` | `inferSourceTier` classifies `blog`-named feeds as `researcher_blog`. The CyberArk feed escapes this only because its name contains `security advisories`. |
| 6 | §13 KEEP trigger: "Monitored vendor + medium/critical" | Covered | Branch 2 explicitly: `(vendors.vendors.length > 0 && keywords.medium.length > 0) → KEEP`. Compatible. |
| 7 | §13 KEEP trigger: "Government/CERT source with security context" | KEEP regardless of keywords | Implementation: `sourceTier === 'government_cert'` alone enters Branch 2, but with no other signal and a strong-negative dominance check it demotes to MAYBE_KEEP. A pure government_cert feed with no content at all could land at MAYBE_KEEP if the body matches a negative keyword. |
| 8 | `cheap_filter_no_cyber_keyword_in_rss_metadata` blocking reason | (not in standard) | Always emitted when critical+medium+low are *all* empty — but medium *does* count as a cyber keyword in spirit, so the reason name is misleading. Consider renaming to `_no_critical_or_medium_cyber_keyword_in_rss_metadata` or simply dropping when medium is present. |
| 9 | Branch 1 silent demotion path | (not in standard) | A `vendors.products.length > 0 && hasCyberContext` article whose product match came from medium keywords + security_media source goes straight to KEEP regardless of negative keywords — `hasNegativeDominance` is *not* checked in Branch 1. The standard's "negative keyword + strong positive signal → do not automatically drop" is interpreted here as "do not *demote* KEEP either". |
| 10 | Stale penalty applies unconditionally | (not in standard) | `isOld` subtracts 20 and adds a blocking reason regardless of any other signal. Combined with no hard threshold (deviation #1), an old KEV-from-yesterday article that re-surfaces 15 days later can be demoted to MAYBE_KEEP purely by staleness. |

---

## 11. Why this matters for the gate

`npm run eval:cheap-filter` reports precision / recall / confusion matrix against the labelled dataset. The gate fails when:

- any `CRITICAL_RELEVANT` article is DROPPED (critical recall < 100%)
- `relevant` recall drops below 95%
- reason-code coverage on the failure set falls below 100% (every failure has an explainable reason)

Most of the "false negatives" the gate catches will come from deviations #1, #2, #3, and #10. If a deviation changes a decision in a way that improves eval metrics, update §10 here and the standard together so they stay aligned.