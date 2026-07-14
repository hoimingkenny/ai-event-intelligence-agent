# Code Review: Workspace create event + membership (#16)

- **Branch:** `feat/workspace-create-membership` → `main`
- **Commits:** (this PR)
- **Date:** 2026-07-14
- **Reviewer:** Cursor agent

## Summary of change

Extends the analyst editorial seam so operators can create a draft canonical event from one or more articles and manage membership (attach / detach / move). Workspace UI adds a triage strip, `/workspace/new` create flow, and membership controls on the event edit page. Merge/split of whole events remains out of scope (ADR-0002).

## Behaviour changes

- New editorial APIs: `createEventFromArticles`, `attachArticleToEvent`, `detachArticleFromEvent`, `moveArticleBetweenEvents`, `listArticlesNeedingTriage`, `listWorkspaceEventArticles`.
- Created events always start as `draft`; approval stays a separate step (#15).
- Triage list = articles not attached to any `approved` event (draft-only membership still shows in triage).
- Detach refreshes `source_count`; move is detach-then-attach across distinct events.
- Repository helpers: `ArticleRepository.findByIds`, `EventRepository.detachArticle`, `listArticlesNeedingTriage`.

## Risks and concerns

- **Create is not transactional** across create + N attaches — a mid-loop failure can leave a draft with partial membership; acceptable for phase 1; retry/attach from UI covers recovery.
- **Triage can be large** in a full pipeline DB — UI caps lists (workspace preview 12, create 80, attach 40).
- **Articles may still sit on other draft events** while appearing in triage — intentional per “not on an approved event”; attach uses `ON CONFLICT` upsert so re-attach is safe.
- **No empty-event cleanup** after detaching the last article — empty drafts can remain until manual handling.

## Test evidence

- `npx vitest run tests/event-editorial.test.ts tests/event-editorial-membership.test.ts tests/event-repository.test.ts` — pass (14)
- `npm run check` — pass
- `npm run web:build` — pass (includes `/workspace/new`)

## Follow-ups

- #17 Compose deploy
- Optional: wrap create/move in a DB transaction; paginate triage

## Verdict

Approve — membership ops are covered at the editorial seam, create always attaches selected articles (or fails closed on empty selection), and workspace UI wires the flows behind existing analyst auth.
