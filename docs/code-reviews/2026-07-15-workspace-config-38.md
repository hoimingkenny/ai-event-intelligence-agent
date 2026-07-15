# Code Review: Workspace Config feed writes (#38)

- **Branch:** `feat/workspace-config-38` → `main`
- **Commits:** `0562cae..HEAD`
- **Date:** 2026-07-15
- **Reviewer:** Composer

## Summary of change

Adds analyst-managed feed writes to Config → Feeds. A dedicated Workspace Config seam validates and normalizes feed input, maps Postgres URL-uniqueness violations to typed errors, creates workspace feeds as RSS, updates only editable metadata, and soft-deactivates/reactivates feeds without deleting rows. Analyst-gated Next.js Server Actions persist changes and revalidate Config pages; they do not call ingest or any pipeline stage.

The read-only feed table is replaced by add/edit forms with read-only ID, source type, and last-fetched metadata. Duplicate URL and validation failures are surfaced next to the affected form. Activation changes require browser confirmation, and attempts that would leave zero active feeds display a warning before posting and are rejected server-side.

## Behaviour changes

- Analysts can add feeds with source name, URL, trust level, and active state. New feeds always persist `source_type = 'rss'`.
- Analysts can edit source name, URL, and trust level. Existing source type, active state, ID, and last-fetched timestamp are not changed by the details update.
- Deactivate/reactivate uses `UPDATE feeds SET is_active = ...`; no hard-delete path is exposed.
- Duplicate feed URLs are rejected by the existing Postgres unique constraint and surfaced as a typed `duplicate_url` error.
- Trust level is limited to `low`, `medium`, or `high`, matching the existing feed values/domain convention.
- The implementation rejects a save that would leave zero active feeds. This follows the explicit #38 implementation/test instruction; it is intentionally stricter than the older `docs/design/workspace-config-update-flow.md` statement that zero active feeds were allowed with a warning.
- Saves only persist and revalidate Config pages. They do not fetch the feed, enqueue work, or trigger ingest.

## Risks and concerns

- **Concurrent last-feed deactivation:** a count preflight provides a typed error without writes; the repository update also has an `EXISTS` predicate so a concurrent request cannot deactivate the final active row between the check and update. A zero-row guarded update is mapped back to `last_active_feed`.
- **Trust-level database constraint:** validation is enforced in the Workspace seam, not by a new SQL constraint, because seed/upsert paths predate this ticket and must remain unchanged. Direct SQL or other repository callers could still store another value; accepted for this ticket's scoped Workspace seam.
- **Form error recovery:** Server Actions redirect with a typed error code, so invalid submitted values are not retained after the redirect. The affected form and clear error are shown, but analysts must re-enter changes. Accepted to keep the implementation aligned with existing redirect/revalidation patterns rather than introducing action-state infrastructure solely for this page.
- **Legacy rows with non-RSS or null source type:** they remain visible and read-only; edits do not coerce historical source types. Only newly created Workspace feeds are forced to RSS.
- **No live database integration test:** uniqueness is tested by a scripted Postgres `23505` and the last-active no-write path is tested at the query boundary. The existing database uniqueness constraint remains the system-of-record enforcement.

## Test evidence

Verification was run against the isolated committed snapshot at `11ed2e0`, excluding concurrent uncommitted #37 inventory work:

- `npm run check` — passes.
- `npx vitest run --exclude tests/llmHelpers.test.ts` — 66 test files passed, 2 skipped; 337 tests passed, 5 skipped, 0 failed.
- `npx vitest run tests/workspace-config.test.ts tests/workspace-feed-writes.test.ts` — 2 test files passed; 10 tests passed.
- `npm run web:build` — Next.js 15.5.9 production build compiled, type-checked, generated routes, and completed successfully; `/workspace/config/feeds` included.
- Feed-scoped ESLint — exits 0 (with the repository's pre-existing Next pages-directory advisory).
- `tests/llmHelpers.test.ts` was deliberately not run because the ticket identifies it as network-dependent outside CI.

Seam coverage includes create-as-RSS behavior, editable-field/source-type lock, trust-level validation, soft-deactivate/reactivate without delete, duplicate URL typed-error mapping, no-write rejection for final active-feed deactivation, no-write rejection for creating an inactive feed when none are active, and absence of article/ingest writes.

## Follow-ups

- Reconcile the older update-flow design note's “zero active feeds allowed” statement with #38's implemented server-side invariant.
- If preserving submitted values after validation failures becomes important, adopt action state for Config forms consistently rather than adding a page-specific form-state pattern.
- A future migration may add a database `CHECK` for feed trust levels once all non-Workspace writers are confirmed compatible.
- Fetch-now, ingest triggering, and historical article rewrites remain deliberately out of scope.

## Verdict

**Approve-with-notes.** #38's acceptance criteria and required tests are met; the only notable follow-up is aligning the older zero-active design documentation with the ticket's stricter server-side invariant.
