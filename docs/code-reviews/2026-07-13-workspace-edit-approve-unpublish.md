# Code Review: Workspace edit / approve / unpublish (#15)

- **Branch:** `feat/workspace-edit-approve-unpublish` → `main`
- **Commits:** (this PR)
- **Date:** 2026-07-13
- **Reviewer:** Cursor agent

## Summary of change

Adds the analyst editorial seam (`src/events/event-editorial.ts`) for field updates, event approval, and event unpublish, plus `/workspace` UI to list draft/approved events and edit/approve/unpublish them. Approving flips `publication_status` to `approved` (public catalogue visibility); unpublish returns to `draft`. Server actions gate mutations with `requireAnalyst`. See ADR-0002 and issue #15 / parent #10.

## Behaviour changes

- `/workspace` is no longer a stub: lists all events (draft + approved), links to `/workspace/events/[id]`.
- Analysts can edit title, summary, severity/urgency, vendors/products, CVEs, attack types without changing publication status.
- Approve / unpublish mutate publication status only; pipeline may still enrich approved events in place.
- Alerts remain ungated by publication status (`listAlertCandidates` does not filter on it).

## Risks and concerns

- **Form list parsing** is comma-split only — values containing commas need care; acceptable for phase 1.
- **No optimistic locking** — concurrent pipeline enrichment vs analyst edit can race; sticky-approval model accepts in-place updates.
- **Membership create/edit** still out of scope (#16) — analysts cannot yet attach/detach articles from this UI.
- Auth failures on mutations redirect rather than returning structured errors; consistent with existing workspace gate.

## Test evidence

- `npx vitest run tests/event-editorial.test.ts tests/event-repository.test.ts tests/events-portal.test.ts tests/workspace-access-gate.test.ts` — pass
- `npm run check` — pass
- `npm run web:build` — pass (includes `/workspace/events/[id]`)
- Full `npm test`: 3 network-dependent LLM/embedding failures (MiniMax/Ollama unavailable in this environment); unrelated to this change. Remaining suite green.

## Follow-ups

- #16 Workspace create + membership
- #17 Compose deploy

## Verdict

Approve — editorial seam is tested at the intended boundary, workspace mutations are auth-gated, and public catalogue / alert gating behaviour matches ADR-0002.
