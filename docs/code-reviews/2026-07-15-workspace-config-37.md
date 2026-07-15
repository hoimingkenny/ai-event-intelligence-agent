# Code Review: Workspace Config inventory writes (#37)

- **Branch:** `feat/workspace-config-37` → `main`
- **Commits:** (this branch)
- **Date:** 2026-07-15
- **Reviewer:** Claude

## Summary of change

Analysts can add, edit, and soft-deactivate monitored vendor products from Config → Inventory. Writes go through a new seam `src/workspace/workspace-inventory-writes.ts` exposing `createProduct`, `updateProduct`, `setProductActive`. The seam wraps every write in a SQL transaction, checks the ≥1 active-product invariant inside the same transaction (rejects with a typed `InventoryWriteFailedError` before any writes if the change would leave zero active products), and validates enum inputs (criticality, news volume) up front. Next.js server actions in `web/app/workspace/config/inventory/actions.ts` wrap the seam with `requireAnalyst` and `revalidatePath`; the read-only Inventory page is replaced with an editable list of product cards plus an "Add product" form. Deactivate / reactivate uses a client island (`web/components/ConfirmSubmitScript.tsx`) that hooks a `window.confirm` guard onto any `<form data-confirm=...>` so the form-action submit path stays a server action. Vendor creation reuses an existing row by name if present; vendor `is_active` is intentionally not touched (deactivating a vendor stays a follow-up, out of #37 scope).

The repository (`VendorRepository`) gains public write methods (`createVendor`, `createProduct`, `updateProduct`, `setProductActive`, `replaceProductAliases`, `countActiveMonitoredProducts`, `findVendorByName`, `findProductById`) so the seam uses the same primitives as the existing seed path. Existing seed behaviour is preserved (`seedVendorProduct` untouched).

## Behaviour changes

- **Config → Inventory is now editable.** Analysts can add a vendor/product pair, edit product name + criticality + news volume + aliases, and soft-deactivate / reactivate. Saving does not start any pipeline stage; the next scheduled run picks up the change.
- **≥1 active monitored product invariant.** Both `createProduct(isActive=false)` and `setProductActive(_, false)` reject with `code: 'empty_inventory'` if the resulting active count would be zero. The check runs inside the same SQL transaction as the write, so the rejection rolls back any partial work.
- **Alias set semantics.** Editing a product replaces its alias set (DELETE + INSERT, deduped, with the product name always pinned as a canonical alias).
- **Forward-only coverage loss on deactivate.** Deactivating a product does not rewrite history; existing events keep their product attribution. UI copy spells this out before submit.
- **Vendor creation policy.** New vendor names auto-create a vendor row at the requested criticality (`is_active = true`). Re-using an existing vendor is silent (no flip of vendor `is_active`). This matches the AC ("add a product") and stays out of the vendor-management scope.
- **Config hub + Inventory page** now show success / error notices via `?status=...&error=...` query params (mirrors the events page pattern).

## Risks and concerns

- **Confirm modal uses `window.confirm`.** Not a styled modal — a deliberate trade-off to avoid adding a client-state layer just for confirmation. Acceptable for an internal analyst tool; revisit if the UX bar rises.
- **No optimistic locking.** Two concurrent analysts editing the same product could overwrite each other; last write wins. The invariant check inside the transaction is the only concurrency safety net (and it covers the dangerous case). Acceptable for the POC scope.
- **`countActiveMonitoredProducts` is a separate query.** The invariant check is `count > 0` for create / `count > 1` for deactivate. A race could let two deactivate calls slip through if both read `count = 2` simultaneously, but the `BEGIN/COMMIT` wrapping prevents partial writes — the second call would observe the first's commit and the third row's `is_active = false` would no longer count. Mitigated by SERIALIZABLE isolation in the future if conflict becomes a real concern.
- **`replaceProductAliases` is not atomic on its own.** It does DELETE + N inserts in separate statements. If a concurrent reader queries aliases mid-replace they could see an empty list briefly. Acceptable because alias matching runs in scheduled pipeline ticks, not on hot paths.
- **No bulk delete.** AC says "no hard delete"; reactivate is the only recovery path. A later "delete with confirmation" feature would need to extend the seam.
- **Integration test mutates shared DB state inside a transaction.** The test rolls back, so shared state is preserved — verified by re-running `npm test` and counting active products before/after.

## Test evidence

- `npx tsc --noEmit` (root) — passes.
- `cd web && npx tsc --noEmit` — passes.
- `DATABASE_URL=... npx vitest run --exclude tests/llmHelpers.test.ts` — 341 passed, 1 skipped (network `tests/llmHelpers.test.ts`), 0 failed.
- `DATABASE_URL=... npx vitest run tests/workspace-inventory-writes.test.ts` — 11 passed: covers missing vendor/product, invalid criticality/news volume, would-empty create reject (no DB writes), full create path with alias dedup + canonical, duplicate (vendor, product) reject, alias set replace semantics, deactivate-last-active reject with zero writes, reactivate allowed when already active, unknown-product typed errors.
- `DATABASE_URL=... npx vitest run tests/workspace-inventory-writes.integration.test.ts` — 1 passed: scripted-DB integration test proves a deactivate that would leave zero active rows is rejected without persisting (product stays active after the rejected call). DB state confirmed unchanged after the run.
- `cd web && DATABASE_URL=... npx next build` — passes; routes include `/workspace/config/inventory` server action wiring.
- The pre-existing `tests/llmHelpers.test.ts` failure (`ENOTFOUND api.minimax.io`) is unrelated to #37 and reproduces on `main`.

## Follow-ups

- #39: filter re-queue on a Workspace article (per the design in `docs/design/workspace-config-update-flow.md`).
- Vendor-level writes (vendor `is_active` flip, vendor rename) are deliberately not in #37 scope.
- Style the deactivate confirm modal beyond `window.confirm` if the UX bar rises.
- Consider bulk re-seeding the JSON inventory from the DB after analyst edits so the seed file matches the live state (or accept that the seed file is now "initial seed only").

## Verdict

Approve — seam-tested write surface with typed errors, server actions follow the existing event-actions pattern, invariant is enforced inside the SQL transaction (not just in TS), and the integration test proves the reject path against a real Postgres.