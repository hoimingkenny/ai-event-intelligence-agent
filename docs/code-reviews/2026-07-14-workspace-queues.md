# Code Review: Workspace hub + paginated queues

- **Branch:** `feat/workspace-queues` → `main`
- **Commits:** (see branch log)
- **Date:** 2026-07-14
- **Reviewer:** Auto (Composer)

## Summary of change

Splits the monolithic `/workspace` events queue into a **hub** plus three dedicated queues (`/workspace/triage`, `/workspace/drafts`, `/workspace/approved`), each with **25/page** Prev/Next pagination. Adds persistent workspace subnav and extends the editorial seam with paginated list + count helpers (`listArticlesNeedingTriagePage`, `listWorkspaceEventsPage`, `getWorkspaceQueueCounts`). `/workspace/new` keeps the create flow and shares the paginated triage query.

## Behaviour changes

- `/workspace` no longer lists triage articles or events; it shows live counts and links into the three queues.
- Create-flow triage picker is paginated at **25** (was a hard-capped **80** on one page). Selections do not persist across pages — only the current page’s checkboxes are submitted.
- Event detail “back” links to drafts or approved depending on publication status.
- Mutating server actions revalidate the three new queue paths as well as `/workspace` and `/workspace/new`.

## Risks and concerns

- **Create selection vs pagination:** Analysts on page 2+ can only create from articles visible on that page. Accepted for PoC; triage→create deep-link (Option 2) is a follow-up.
- **Page-size constants:** Web `WORKSPACE_PAGE_SIZE` and editorial `DEFAULT_PAGE_SIZE` are both 25 but separate; non-page callers still pass ad-hoc limits (e.g. attach candidates 40). Acceptable drift for now.
- **Empty queues hide pagination chrome:** `WorkspacePagination` returns null when `total === 0`. Harmless.

## Test evidence

- `npm run check` — pass
- `npx vitest run tests/event-editorial.test.ts tests/event-editorial-membership.test.ts` — 17 passed (pagination + hub counts)
- `npm test` — editorial tests green; unrelated `llmHelpers` failures when MiniMax network is unreachable in sandbox
- `cd web && npx tsc --noEmit` — pass

## Follow-ups

- Triage row → create with article preselected (grilled Option 2)
- Share a single page-size constant across web + editorial
- Optional empty-state pagination row

## Verdict

**Approve-with-notes** — Spec Option A is implemented; revalidation for new routes is covered; create-page size change and selection-across-pages limitation are accepted PoC trade-offs.
