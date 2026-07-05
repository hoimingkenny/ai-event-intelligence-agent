# Code Review: Local deterministic test source + ad-removal nesting fix

- **Branch:** `feat/local-test-source` → `main`
- **Date:** 2026-07-02
- **Reviewer:** Claude

## Summary of change

Adds a deterministic local "news site" (`test-source/`: RSS feed + 5 article pages + a zero-dependency static server, `npm run test-source:serve`) so the pipeline can be studied and tested end to end without live, ever-changing RSS data. The five articles are scenario-designed: a CyberArk zero-day plus a differently-worded follow-up sharing the CVE (exercises the grouping-key rung), a separate SailPoint event, a Zscaler advisory with an embedded native-ad cluster (exercises ad removal), and a non-cyber article (exercises the cheap filter's reject path). All vendors match the monitored inventory.

Building this immediately paid off: end-to-end verification of the ad article exposed a real bug — on the Readability path (no per-source selector), ad-cluster and banner removal resolved blocks relative to the extraction root, but Readability nests its output in wrapper divs, so the "block" was the whole article and banner removal deleted **all content**. Fixed by resolving cluster spans against the anchors' lowest common ancestor and climbing only through text-empty wrappers for banners.

## Behaviour changes

- Ad-cluster/banner removal now works correctly on the Readability path; previously any article with an offsite image-only link extracted as empty (`method: none`) and would have been marked extraction-failed.
- New npm script `test-source:serve` (port 8787, `PORT` overridable). No pipeline code paths change for production sources.

## Risks and concerns

- The nesting bug escaped existing tests because they all used the selector path (flat children). A regression test now covers the nested-wrapper case explicitly. Lesson recorded: test both routing paths for any DOM-walking logic.
- Test articles use fictional CVE IDs (CVE-2026-21001/22002) — they will parse as real CVE entities by design; don't run the test feed against a production database.
- Static server has path-traversal protection and serves only `test-source/`.

## Test evidence

- `npm run check` clean; vitest 89 passed / 4 skipped (3 pre-existing MiniMax network failures only), including the new nested-wrapper regression test.
- End-to-end against the running local server: CyberArk article recall 1.00 / filter passes on cve+exploit keywords; Zscaler article recall 1.00 with ad cluster fully removed and both surrounding paragraphs intact; picnic article correctly rejected by the cheap filter.

## Follow-ups

Optional: a `db:seed:test-source` script to register the local feed automatically (currently a documented one-line SQL insert in the server script header).

## Verdict

**Approve.** Small, isolated addition whose verification process caught and fixed a genuine extraction bug — exactly what a deterministic test source is for.
