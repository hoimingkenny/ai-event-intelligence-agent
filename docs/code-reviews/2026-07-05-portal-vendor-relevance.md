# Code Review: Portal vendor relevance ("closest monitored vendor")

- **Branch:** `feat/portal-vendor-relevance` → `main`
- **Date:** 2026-07-05
- **Reviewer:** Claude

## Summary of change

Adds per-article **vendor relevance** to the article portal: how strongly the article relates to a monitored vendor, and which one is the closest match. Requirement clarified via interview — the user wanted "how related to a monitored vendor, and if so which is closest", not a recall metric (an early answer would have produced a trivially-100% number; that trap is noted below).

Definition: `vendorRelevance` = the highest confidence among the article's detected monitored-vendor entities; `topVendor` = the vendor holding that top confidence. It reuses the existing confidence-scored entities (confidence already blends placement — title/lead strong, footer weak — and corroboration with CVE/attack keywords), surfaced live via a `LEFT JOIN LATERAL` over `article_entities`. No new column, no migration, and it reflects the latest confidence (including the classification cross-check reconciliation).

Portal shows it as a "Vendor (closest)" column (name + relevance bar), a detail-panel row, and a new "Most vendor-relevant first" sort.

## Behaviour changes

- Portal list/detail responses gain `topVendor` + `vendorRelevance`; new `sort=vendor_desc`.
- Read-only; no schema change; no pipeline change.

## Risks and concerns

- **The recall trap (why this design):** comparing "vendors in summary" against "vendors the detector found" would be ~always 1.0 because the detector scans the summary itself. Relevance-from-confidence avoids that and answers the actual question.
- **"Closest" = highest-confidence single vendor.** Ties break by name; an article about two vendors surfaces only the top one in the column (all vendors remain in the detail entities list). Acceptable for an at-a-glance column.
- **LATERAL runs per listed row** (≤ limit, HNSW-free simple index on `article_entities.article_id`) — fine for a human-driven inspection tool.
- **WHERE-clause aliasing:** filters are now built with the `a.` alias and both list and count queries use `articles a`; verified by the existing filter/search tests still passing.

## Test evidence

- `npm run check` clean; `vitest` 140 passed / 4 skipped (3 pre-existing MiniMax network failures only). Portal tests updated for the new fields + a detail assertion on `topVendor`/`vendorRelevance`; shell test asserts the new column and sort option.

## Follow-ups

Optional aggregate (median vendor relevance) in the header; multi-vendor display if single-closest proves too coarse.

## Verdict

**Approve.** Answers the clarified requirement by reusing the confidence-scored entities, with no schema or pipeline change, and sidesteps the always-100% recall trap.
