# Code Review: JSON-editable vendor inventory + Inventory tab

- **Branch:** `feat/cheap-filter-eval-workflow` → `main`
- **Commits:** follows `d8ad8a6`
- **Date:** 2026-07-07
- **Reviewer:** Claude

## Summary of change

The monitored vendor/product inventory was a hardcoded TypeScript array, so growing alias lists (the main tuning lever for the cheap filter's vendor path) required a code change. The inventory now lives in `config/monitored-vendors.json`, and the eval review UI gains an **Inventory** tab where the operator pastes a JSON array — typically LLM-generated — validates, and saves.

Details: `src/storage/vendorInventory.ts` loads the JSON at import and keeps the exported `monitoredVendors` array identity stable; `saveMonitoredVendors`/`reloadMonitoredVendors` mutate it in place, so every in-process consumer (filter stage, entity extractor, eval derivation, `/api/report`) sees updates without a restart. Validation via zod: `id` optional (derived as `vp_<slug>` from vendor+product), aliases deduped, duplicate vendor+product pairs rejected, empty inventory rejected. New endpoints `GET/POST /api/inventory` (POST returns added/removed ids); JSON body limit raised 64KB→512KB for large pasted inventories. The tab includes a copyable LLM prompt template and an "after saving" note (restart scheduler/worker, `seed:vendors` to sync the DB copy, re-filter to re-score old articles).

## Behaviour changes

- Inventory source of truth moved to `config/monitored-vendors.json` (same 3 POC products; content unchanged). Missing/invalid file now fails fast at process start with a clear error.
- `parseVendorInventory` rejects duplicate vendor+product pairs and empty arrays — previously unenforceable.
- No pipeline logic changes; detection behaviour identical for identical inventory content.

## Risks and concerns

- **In-place mutation** of the exported array is unconventional but deliberate (documented in the module); consumers never hold stale copies because nothing clones the array. Verified end-to-end in a smoke test: after POSTing a replacement inventory, `/api/report` immediately stopped matching the removed vendor.
- **Concurrent writes** to the JSON (UI save + manual edit) last-writer-wins; acceptable single-operator tool.
- A bad paste replaces the whole inventory — mitigated by validation, the added/removed summary in the response, "Reset to saved", and git history on the config file.

## Test evidence

- `npm run check`: clean. `npm test`: 182 passed / 4 skipped; only the 3 pre-existing MiniMax live-API tests fail (offline).
- New tests: id derivation + alias dedupe + duplicate/empty rejection; save/load round-trip on a custom path; `GET /api/inventory` serves the live inventory.
- Manual smoke: GET → POST (replace with Okta) → `/api/report` showed the CyberArk sample no longer matching vendor signals without a server restart; config restored afterwards.

## Follow-ups

- Optional: per-entry diff preview before save; inventory versioning beyond git.
- `seed:vendors` sync could be triggered from the UI later if the DB copy becomes authoritative for more stages.

## Verdict

Approve — config extraction with strict validation, hot reload verified live, and the paste-JSON workflow matches how the operator actually produces alias lists.
