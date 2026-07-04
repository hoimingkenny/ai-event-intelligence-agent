# Code Review: Readability-based extraction, quality metrics, drift detection

- **Branch:** `codex/evaluation-and-plan-alignment` → `main`
- **Commits:** `03e9d4f` (25 files, +5751/−36)
- **Date:** 2026-07-02
- **Reviewer:** Claude (retroactive — this review documents the merge that established the review process)

## Summary of change

Replaces regex-strip / `body.innerText` article extraction with a layered cleaner (`src/extraction/readable-content.ts`): per-source CSS selectors for curated feeds → DOM pruning + Mozilla Readability → boilerplate line filtering, plus structure-based native-ad cluster removal. Adds a free per-article quality metric (`rss_recall`, word recall of the RSS summary against extracted text) and per-source rolling drift detection so a broken selector or site redesign is surfaced the same day. Ships a real-HTML fixture harness for human side-by-side evaluation. Rationale and debugging narrative: `docs/engineering-notes/extraction-quality-evaluation.md`.

## Behaviour changes

- **Playwright fallback disabled by default** in `ExtractionRouter` (still injectable). JS-only sites that previously succeeded via Playwright will now record `http_failed`. Accepted: current curated feeds are all server-rendered.
- **`contentQualityScore` semantics changed** from pure length to length × boilerplate-density penalty. The `score <= 0` failure check in `HttpArticleExtractor` can now fail a page that is long but boilerplate-saturated — intended, but a behaviour change for borderline pages.
- **Migration required** (`004_extraction_quality.sql`): extraction saves write `rss_recall`; running new code against an un-migrated database fails. Deploy order: migrate first.
- **Pipeline runner now queries drift after every extraction stage** — one additional window-function query per run, supported by the new `(source_name, extracted_at DESC)` partial index.

## Risks and concerns

- **Ad-cluster removal false positives.** Removing sibling spans between repeated offsite links could eat real content. Mitigated by guardrails (span ≤ 8 blocks, ≤ 800 chars, same-site exemption, CTA/heading/image-link requirement) and a dedicated negative test (same NVD link cited twice survives). Residual risk accepted; fixtures will catch regressions.
- **`wordRecall` uses raw bag-of-words including stopwords**, which inflates recall — a wrong-but-wordy extraction can score moderately. Acceptable because drift detection consumes *relative change* (median collapse), not absolute values. Follow-up: stopword filtering would sharpen the metric.
- **Per-source selectors are best guesses** against current site markup, verified only for BleepingComputer/SecurityWeek via fixtures. A wrong selector degrades gracefully to Readability, and drift detection now makes that visible.
- **Committed third-party HTML fixtures** (~260 KB, BleepingComputer + SecurityWeek). Standard practice for extraction test assets, but keep the set small and don't redistribute beyond the repo.
- **linkedom fragility**: bare fragments silently lose content (bug found during development). Now wrapped as full documents and noted in CLAUDE.md; a non-empty intermediate assertion would be a stronger defence (follow-up).

## Test evidence

- `npm run check` clean.
- `vitest`: 76 passed, 4 skipped; only pre-existing failures are 3 live MiniMax API tests (network-gated, unrelated).
- Fixture regression: both real fixtures extract non-empty article text; synthetic BC ad-cluster page: recall 100% / precision 100% against human reference.

## Follow-ups

Stopword filtering in `word-overlap`; per-domain rule storage in DB + LLM-assisted rule re-learning triggered by drift (§5 of the engineering note); semantic dedup vector still not wired into the dedup stage (pre-existing gap).

## Verdict

**Approve with notes.** The layered design degrades gracefully, every heuristic has both positive and negative test coverage, and the change makes its own failure modes observable — the follow-ups are sharpening, not gaps in safety.
