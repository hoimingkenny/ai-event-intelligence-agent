# Code Review: Narrow POC scope to 3 vendor products with tier-diverse sources

- **Branch:** `feat/cheap-filter-eval-workflow` → `main`
- **Commits:** second commit on branch (after eval-workflow commit `edd7b6e`)
- **Date:** 2026-07-07
- **Reviewer:** Claude

## Summary of change

The 5-product monitored inventory made evaluation impractical: the operator could not realistically find and label source articles across all vendor products. This narrows the whole proof of concept to 3 products chosen to exercise different filter paths — CyberArk PAS (quiet vendor, critical asset), Zscaler ZIA (mid-volume), Microsoft Windows Server/Exchange/Entra (high-volume, noisy vendor with negative-context suppression) — and diversifies sources by tier instead of by vendor count.

Changes: `vendorInventory.ts` trimmed (SailPoint IIQ, Cloudflare removed); `rssFeeds.ts` now spans four source tiers (CISA = government_cert, MSRC = official_vendor, CyberArk Blog = researcher_blog, Krebs/BleepingComputer/THN = security_media) — both new feed URLs verified live (MSRC returns valid RSS; CyberArk `/feed/` returns rss+xml). Zscaler's trust portal has no public RSS (JS-rendered), documented in the file; ZIA coverage comes from CISA + security media for now. The eval dataset was rebuilt: 14 samples covering the 3 products across tiers (4 CRITICAL, 4 RELEVANT, 2 WEAK, 4 IRRELEVANT incl. two monitored-vendor business-news traps), written in the new minimal record format (id/expectedMinimumDecision/expectedSignals derived).

## Behaviour changes

- Pipeline now only detects/keeps articles for the 3 remaining products; SailPoint/Cloudflare mentions no longer match vendor signals.
- Two new RSS feeds will be ingested after the next `npm run db:seed` (feeds are upserted; the old feed rows remain active in existing databases — deactivate manually if unwanted).
- Eval dataset content replaced; sample ids changed to derived `cf-<hash>` form.
- Three tests updated to use in-scope vendors (semantics preserved: same filter paths asserted).

## Risks and concerns

- **Known accepted failures in the eval report:** the two vendor business-news samples pass as MAYBE_KEEP (`irrelevant_maybe_kept`, low severity) because a monitored-vendor mention plus recency scores ≥15 by design. Gate still passes (100% critical/relevant recall, 0 false negatives). Left in deliberately so the failure-bucket machinery is visible in the POC report.
- **MSRC feed volume** is high and Microsoft is in the noisy-vendor list; expect elevated MAYBE_KEEP counts — that is the scenario the POC is meant to measure.
- **Zscaler official-advisory gap** documented; if ZIA advisories matter operationally before a scraper exists, CISA/security-media latency is the fallback.

## Test evidence

- `npm run check`: clean.
- `npm test`: 171 passed / 4 skipped; only the 3 pre-existing MiniMax/OpenRouter live-API tests fail (network unavailable in sandbox, unrelated).
- `npm run eval:cheap-filter`: gate passed; critical recall 100%, relevant recall 100%, false negatives 0; confusion matrix CRITICAL 4×KEEP, RELEVANT 4×KEEP, WEAK 2×MAYBE_KEEP, IRRELEVANT 2×DROP + 2×MAYBE_KEEP (the accepted traps above).
- Feed URLs verified by live fetch during review.

## Follow-ups

- Deactivate stale feed rows in any existing database after reseeding.
- Add a Zscaler trust-portal scraper source for official ZIA advisories.
- Grow the dataset toward 50+ samples via `eval:candidates` + `eval:review` once real ingestion runs at POC scope.

## Verdict

Approve — scope reduction is configuration + dataset only, filter logic untouched, and the evaluation gate stays green with the known irrelevant-pass cost explicitly documented.
