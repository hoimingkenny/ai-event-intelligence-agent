# Code Review: cheap-filter triage

- **Branch:** `feat/cheap-filter-triage` -> `main`
- **Commits:** pending
- **Date:** 2026-07-07
- **Reviewer:** Codex

## Summary of change

This change refactors the cheap-filter stage from a binary extract/drop gate into a scored triage decision: `KEEP`, `MAYBE_KEEP`, or `DROP`. It persists the cheap-filter decision, score, reason codes, blocking reason codes, and matched signals so the human review dashboard and future monitoring work can explain why an item moved forward or was ignored.

The change also stores RSS categories on articles and uses security-relevant categories as weak evidence. Extraction now processes normal extraction candidates before low-priority candidates, so `MAYBE_KEEP` articles remain available for downstream review without blocking stronger signals.

The cyber keyword classification standard was added to `docs/design/` as the reference standard for the cheap-filter keyword layer.

## Behaviour changes

Articles with strong RSS metadata signals, such as CVEs, critical exploitation language, monitored products with cyber context, official vendor advisories, or government CERT sources, are promoted to `EXTRACTION_PENDING`.

Articles with weaker but plausible cyber signals, such as security-media coverage with medium keywords or security RSS categories, are promoted to `EXTRACTION_PENDING_LOW_PRIORITY`.

Articles without enough cyber/vendor/product evidence are marked `IGNORED` with structured blocking reasons in `processing_error` and cheap-filter evidence fields.

Two migrations add `articles.rss_categories` and the cheap-filter evidence fields.

## Risks and concerns

Keyword scoring can still create false positives when business language overlaps with security language. This is mitigated with negative business-context keywords, noisy vendor-only suppression, source-tier scoring, and explicit tests for common false positives such as "market opportunity" and "breach of contract".

Source-tier inference is currently string-based from `sourceName`, so newly added feeds may be mis-tiered until source metadata becomes more structured. This is acceptable for this layer because the cheap filter remains a heuristic gate and stores reasons for review.

`MAYBE_KEEP` increases downstream extraction volume by design. The priority ordering keeps stronger items ahead of lower-confidence items.

## Test evidence

- `npm run check` passed.
- `env MINIMAX_API_KEY= npm test` passed: 34 test files passed, 3 skipped; 151 tests passed, 10 skipped.

Focused tests were added for cheap-filter decisions, stage status transitions, extraction priority, and RSS category ingestion.

## Follow-ups

Add dashboard views for cheap-filter score, matched signals, and blocking reasons so reviewers can audit false positives and false negatives.

Use human review verdicts to periodically tune keyword weights, negative examples, source tiers, and evaluation fixtures.

Replace source-name tier inference with explicit source metadata once feed trust levels are wired into the pipeline.

## Verdict

Approve with notes: the design improves observability and human reviewability of the cheap-filter layer, while keeping the implementation deterministic and test-covered.
