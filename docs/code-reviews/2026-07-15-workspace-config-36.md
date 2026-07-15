# Code Review: Monitored inventory in Postgres + pipeline load (#36)

- **Branch:** `feat/workspace-config-36` → `main`
- **Commits:** `252bc29`
- **Date:** 2026-07-15
- **Reviewer:** Claude

## Summary of change

Makes Postgres the live monitored inventory for the pipeline. Migration `013` adds `vendor_products.is_active` and `vendor_products.news_volume` (with a `quiet|noisy` CHECK). A new `listActiveMonitoredInventory` seam returns active products from the DB; the filter and entity stages call `loadMonitoredInventoryFromDb` at the start of each run so a Workspace edit takes effect on the next pipeline tick without a restart. `seedVendorProduct` now writes `newsVolume` and propagates `inProduction` to product-level active, preserving the existing `vendors` upsert semantics (`is_active OR EXCLUDED.is_active`, intentionally idempotent — seed flips require a fresh `npm run db:seed`). The Config Inventory page surfaces `newsVolume` and product-level active alongside the vendor name.

JSON remains the seed/eval source of truth. Eval callers (`eval/utils/metrics.ts`, `eval/scripts/import-manual-articles.ts`) explicitly pass `loadMonitoredVendors()` so cheap-filter behaviour stays reproducible independent of the live DB. Tests for the cheap filter pass the same JSON inventory.

## Behaviour changes

- **New columns** (`vendor_products.is_active`, `vendor_products.news_volume`). Default `true` / `'quiet'`. Existing rows default to active/quiet; flipping a product off happens via a re-seed with the JSON updated (not bulk SQL).
- **Cheap filter and entity stage load path moved from JSON module hot path to Postgres read at run start.** First article processed per run pays one extra round trip; otherwise identical.
- **Active-product filter on the pipeline loader.** A product whose vendor or itself is `is_active = false` no longer appears in filter/entity matches.
- **Config Inventory page**: now shows news volume and product-level active. Read-only writes still pending (#37).
- **Workspace Config hub count** for "Active monitored vendor products" now requires both vendor and product active (was vendor active only).

## Risks and concerns

- **Idempotent seed reactivation.** `vendor_products.is_active OR EXCLUDED.is_active` mirrors the existing vendor upsert; it will not flip a product from active back to inactive via a re-seed. Accepted because the JSON file is the canonical seed source and `npm run db:seed` is the intended bootstrap path; partial DB flips should use the planned inventory write UI (#37), not a seed re-run. Documented in the follow-ups.
- **Eval pipeline uses JSON, not DB.** Intentional (per #35/AGENTS), but means cheap-filter eval reports do not change when the DB inventory is edited. The eval gate still measures cheap-filter behaviour against a fixed inventory fixture.
- **Long-running scheduler and worker** each call `loadMonitoredInventoryFromDb` per run. For a single-process scheduler this is fine; for a multi-instance worker the next stage tick picks up the new inventory on whichever worker runs next, which matches the existing eventual-consistency story for Config edits.
- **No automated test exercises a quiet vs noisy row driving the live cheap-filter stage from a scripted DB.** The loader row mapping is tested; the cheap-filter behaviour against `newsVolume` is tested with the JSON fixture. Follow-up: scripted-DB behaviour test.
- **Pre-existing `tests/llmHelpers.test.ts` failures (network `ENOTFOUND api.minimax.io`) are unrelated to #36** and existed before this branch.

## Test evidence

- `npm run check` — passes (`tsc --noEmit`).
- `npx vitest run --exclude tests/llmHelpers.test.ts` — 318 passed, 5 skipped, 0 failed.
- `npx vitest run tests/monitored-inventory.test.ts tests/workspace-config.test.ts tests/detection.test.ts tests/entity-extractor.test.ts tests/entity-confidence.test.ts tests/cheap-filter-stage.test.ts` — all green.
- The pre-existing `tests/llmHelpers.test.ts` failures were not introduced by this branch (verified by reproducing on `main`).

## Follow-ups

- #37: inventory writes (form CRUD + soft-deactivate) so analysts can flip a product off without editing JSON + re-seeding.
- #39: filter re-queue on a Workspace article (per the design in `docs/design/workspace-config-update-flow.md`).
- Add a scripted-DB cheap-filter integration test that proves an active `newsVolume='noisy'` row vs `'quiet'` row drives the L2 corroboration branch (cheap-filter logic is already tested with the JSON fixture; this would close the coverage gap from a DB-backed path).
- Decide whether `newsVolume` and `is_active` should be edited via Config Inventory (#37) or stay seed-only; #37 covers both.

## Verdict

**Approve-with-notes.** Spec is met for #36; the two follow-ups (#37 writes, scripted-DB behaviour test) are tracked, and the seed-reactivation quirk is intentional and consistent with the existing vendor upsert.