# Extraction Quality Evaluation: Debugging Notes and Design Rationale

This document records the full arc of improving article extraction quality in Vendor Threat Watch: how the problem surfaced, the trade-offs behind each cleaning layer, the bugs hit along the way, and how "quality" was ultimately turned into a metric the system can monitor without human review. The end goal: the pipeline should know, on its own and on the same day, that extraction has broken.

---

## 1. Background: why dirty cleanText is a correctness problem

The original implementation had two extraction paths: the HTTP path regex-stripped `<script>`, `<nav>`, and `<footer>` and then removed all remaining tags; the Playwright path took `body.innerText()` wholesale. Both grab the entire page, so cleanText was contaminated with navigation, cookie banners, related-article lists, newsletter CTAs, and native ads.

This looks cosmetic but breaks two downstream consumers:

First, **content-hash deduplication silently fails.** `contentHash = sha256(cleanText)`, and ads and related-article links can differ between fetches. The same article fetched twice produces different hashes, and the exact-duplicate tier stops working with no error surfaced anywhere.

Second, **false vendor entities.** Entity and vendor detection run over cleanText. An article about Linux with a footer link reading "Microsoft patches Exchange zero-day" produces a spurious Microsoft vendor match, which propagates into a false event and a false alert. For a vendor-impact early-warning system, this is the most damaging form of contamination.

So cleaning quality is not about aesthetics — it is a correctness requirement for dedup and entity extraction.

## 2. Layered cleaning design (defence in depth)

No single algorithm extracts perfectly, so the design is a ladder from most-precise-but-narrow to most-general-but-coarse, with each layer falling back to the next:

**Layer 1: per-source CSS selectors.** The feed list is small and curated (CISA, Krebs, BleepingComputer, The Hacker News). For known domains, the article container selector is hard-coded (e.g. `div.articleBody` for BleepingComputer). Deterministic, and near-perfect for the sources that account for 90%+ of volume. The principle: **when the problem space is small, rules beat algorithms.**

**Layer 2: DOM pruning + Mozilla Readability.** Unknown domains take this path. Known-noise nodes (`nav`, `footer`, `aside`, `[class*="related"]`, `[class*="newsletter"]`, `[id*="cookie"]`, …) are removed *before* Readability runs. The ordering matters: Readability is a text-density heuristic that is good at rejecting noise *outside* the article container but happily keeps promotional blocks embedded *inside* it. Pruning first gives the heuristic cleaner input to score.

**Layer 3: text-level post-filter.** After extraction, lines matching boilerplate patterns (`subscribe`, `related articles`, `share this`, `©`, `tags:`, …) are dropped, along with stub lines too short to be content and not shaped like headings.

**Cross-cutting rule: link density.** Any block where more than half the text is anchor text is almost certainly a related-articles list, tag cloud, or navigation. This is the core signal from the Boilerpipe literature — cheap, general, and with a low false-positive rate.

Because the layers are independent, a site redesign that breaks a selector degrades to the Readability layer: quality drops but never goes to zero. That property matters later for drift detection.

## 3. Three bugs worth remembering

This section is the highest-learning-value part of the exercise.

### Bug 1: Readability silently rejects short articles

Symptom: a structurally normal article in a unit test came back `null` from `Readability.parse()`. An isolated reproduction with the same HTML but longer body text parsed fine.

Cause: Readability has a `charThreshold` defaulting to 500 — candidate content blocks below the threshold are discarded outright. Security advisories, CISA's in particular, are frequently under 500 characters.

Fix: `charThreshold: 250`.

Lesson: **third-party library defaults are tuned for the general web, not your domain.** The debugging technique was bisection by isolation — hold the HTML and the library constant, strip away the wrapper code one variable at a time, until the step where behaviour diverges is exposed.

### Bug 2: linkedom silently drops bare-fragment content

Symptom: Readability successfully produced `article.content` (an HTML string), but re-parsing that string with linkedom yielded `document.body.textContent === ''`. No error, no warning — the content simply vanished.

Cause: feeding linkedom a bare fragment via `parseHTML('<body>...</body>')` creates an empty body and discards the child nodes. It must be wrapped as a complete document:

```ts
parseHTML(`<html><head><title>.</title></head><body>${article.content}</body></html>`);
```

Lesson: **lightweight DOM implementations are not browsers; their error-recovery behaviour on non-conforming input is unspecified.** Silent failures like this are the nastiest class. The defence is asserting non-empty intermediate results at each pipeline step rather than only validating final output.

### Bug 3: native ads can't be caught by class names — use structural signals

A user reported a Picus native ad ("Test every layer before attackers do…") leaking into cleanText from BleepingComputer articles. This class of ad sits *inside* the `articleBody` container, its copy is plain `<p>` elements, and nothing in its class names says "ad". A class-name blacklist cannot catch it — and even if it could today, the next site redesign invalidates it.

Inspecting the real page revealed a much more stable **structural signal**: the same external campaign URL (`hubs.li/...`) repeated three times within a small span — a linked banner image, a fully-linked headline, and a "Get the whitepaper" CTA, with two paragraphs of ad copy in between. Genuine article text citing an external source does not take that shape.

The rule became: normalize links (strip utm/query params, group by origin+path) → find offsite URLs appearing ≥2 times → if the cluster contains a CTA-pattern anchor, a fully-linked heading, or an image-only link, remove the entire sibling span from first to last occurrence.

The guardrails against false removal matter as much as the rule itself:

- cluster span ≤ 8 blocks and ≤ 800 characters of text — an article citing the same source twice typically has substantial prose in between and won't match
- same-site links are fully exempt
- a dedicated test asserts that legitimate content citing the same NVD link twice survives intact

Lesson: **target what the adversary can't cheaply change.** Class names are surface features a site can alter at will; "an ad must repeat its campaign link to drive traffic" is a structural property of its business function and far more stable. This is the same reasoning as preferring TTPs over IOCs in threat detection.

## 4. Evaluation: how to measure "clean"

Without measurement there is no improvement. Three complementary mechanisms were built.

### 4.1 Real-HTML fixtures + human reference

`npm run fixtures:fetch -- <url>` saves a real article's raw HTML as a fixture (with the URL recorded in a manifest, since the URL drives selector routing). `npm run fixtures:review` generates a side-by-side page — the original page rendered scriptless on the left, the extracted output on the right — for direct visual judgment.

The human reference is a plain `.expected.txt` file containing what you consider the true article body. With it, two metrics become computable:

```
recall    = fraction of reference text captured      (measures missed content)
precision = fraction of extracted text in reference  (measures noise)
```

Implementation is word-level bag overlap: tokenize both sides into word multisets and compute intersection ratios. Word-level rather than exact string matching, because whitespace, line breaks, and punctuation in extractor output never align with hand-pasted reference text — bag overlap is immune to formatting differences while remaining sensitive to a paragraph of ad copy leaking in or a paragraph of real content going missing.

The fixtures double as regression tests: with a reference present, assertions require recall ≥ 0.8 and precision ≥ 0.6; with no fixtures, the suite auto-skips and never blocks CI.

### 4.2 Free ground truth: RSS summary recall

Human references don't scale — nobody writes expected.txt for hundreds of articles a day. But every article ships with a free proxy for ground truth: **the RSS `<description>` is almost always drawn from the article's opening paragraphs.**

So after every extraction:

```ts
rssRecall = wordRecall(rssSummary, cleanText)
```

When extraction is healthy this approaches 1.0 (an article body necessarily contains its own first paragraph). When the selector grabs the wrong region — a sidebar, say — it collapses. Zero cost, zero LLM calls, a score for every article automatically, persisted as `articles.rss_recall`.

Its limitations need to be stated honestly. (a) Some feeds carry editorially written summaries not taken verbatim from the body, so a healthy baseline might be 0.85 rather than 1.0 — which is fine, because the signal we consume is *change*, not the absolute value. (b) When the `rss_only` extraction path is used (the summary itself becomes the content), the summary's recall against itself is identically 1 and carries no information, so that case records `null` and is excluded from statistics. **An evaluation metric must be protected from being gamed — including by your own pipeline.**

### 4.3 Drift detection: turning the metric into an alarm

With per-article scores in place, "when did the rules break?" becomes answerable: for each source, take the most recent 20 articles and compute median recall, median quality score, and extraction failure rate. Breaching any threshold (recall < 0.6, quality < 0.3, failure rate > 50%) flags the source as drifted.

The design details and their reasons:

**Median, not mean** — individual odd articles (very short advisories, image-heavy posts) drag a mean down and cause false alarms; the median is outlier-immune and only moves on systematic degradation.

**Minimum 5 samples before judging** — a low-volume feed with two bad articles is noise, not signal. Better to detect a day late than to cry wolf.

**Two trigger points** — the pipeline runs the check automatically after every extraction stage (a redesign produces a warning log the same day), and `npm run drift:check` runs standalone with exit code 2 on drift, suitable for cron or CI.

## 5. Why not "re-learn the rules every day"

An intuitive proposal is to schedule an LLM daily to re-analyze each site's structure. It has two flaws: sites redesign every few months, not every day, so daily learning is waste; and more fundamentally, **without a quality metric you can't tell whether a newly learned rule is any good.**

The correct ordering is inverted: first build measurement (rss_recall + drift detection, §4.2/4.3) so that "the rules broke" becomes an observable event — then make rule re-learning an event-triggered action whose output can be validated automatically. The full self-healing loop:

```
every extraction → recall/quality computed (free)
      ↓ rolling median breaches threshold
trigger rule-relearn → LLM proposes new selector from raw HTML
      ↓ re-extract last N articles, validate recall meets threshold
pass → write versioned rule to DB | fail → flag for human review
(Readability fallback carries the load throughout: degraded, never zero)
```

LLM cost approaches zero (a few triggers per year), and every rule update ships with data proving it's an improvement. The pattern generalizes beyond web extraction to any system whose rules drift against the outside world — parsers, classifier prompts, detection signatures: **make degradation observable first, make repair verifiable second, and only then consider automating the repair itself.**

## 6. File index

| File | Responsibility |
|---|---|
| `src/extraction/readable-content.ts` | Three-layer cleaning: selector → pruning+Readability → post-filter; ad-cluster / banner removal |
| `src/extraction/content-cleaner.ts` | `contentQualityScore` (length × boilerplate-density penalty) |
| `src/utils/word-overlap.ts` | Word-level recall/precision |
| `src/pipeline/extraction-stage.ts` | Computes `rssRecall` at extraction time, persists it |
| `src/monitoring/extraction-drift.ts` | Per-source rolling drift detection |
| `src/db/migrations/004_extraction_quality.sql` | `articles.rss_recall` column + index |
| `scripts/fetch-fixture.ts` / `scripts/review-extraction.ts` | Fixture capture + side-by-side review report |
| `tests/readable-content.test.ts` | Cleaning-rule unit tests (incl. false-removal guards) |
| `tests/fixture-extraction.test.ts` | Real-HTML regression (recall/precision thresholds) |
| `tests/extraction-drift.test.ts` | Drift detection unit tests |
