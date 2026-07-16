# Code Review: Filter re-queue on Workspace article (#39)

- **Branch:** `feat/workspace-config-39` → `main`
- **Date:** 2026-07-15
- **Reviewer:** Claude

## Summary of change

Analyst-driven filter re-queue on a Workspace article (`processing_status='IGNORED'` only). Wipes the previous cheap-filter decision and ignore reason, returns the article to `NEW` for the next scheduled sweep to re-evaluate against the current (DB) inventory. No bulk rescan, no pipeline trigger.

## Behaviour changes

- **New seam `src/workspace/article-requeue.ts`**: `requeueArticleForFilter(db, articleId)` runs one `UPDATE articles` with `WHERE id=$1 AND processing_status='IGNORED'` and `RETURNING id, processing_status`. Sets `processing_status='NEW'`, `processing_error=NULL`, and wipes all `cheap_filter_*` columns. `last_processed_at=now()`. Throws `ArticleNotIgnorableError` on zero-row update.
- **Server action `requeueArticleForFilterAction`** in `web/app/workspace/articles/[id]/actions.ts`. `requireAnalyst` gate, redirect on success, redirect with `?error=article_not_ignorable` on rejection. No `revalidatePath` calls are needed beyond the article page (cheap-filter UI does not read filter state).
- **UI**: button on the article detail page (`/workspace/articles/[id]`) shown only when `processingStatus === 'IGNORED'`. Uses the existing `ConfirmSubmitScript` client island for a `window.confirm` guard. Confirmation copy explains what happens next. Success/error flash messages read from `searchParams.requeued` / `searchParams.error`.
- **No new DB columns, no migration.** Cheapest path; the next filter pass will repopulate the cheap-filter columns.
- **No pipeline trigger.** ADR-0003: Web does not start pipeline stages. The next scheduled sweep picks up `NEW` articles via `listByProcessingStatus('NEW', ...)`.

## Risks and concerns

- **Note (post-review):** the initial commit landed without the button markup in `web/app/workspace/articles/[id]/page.tsx` because two `StrReplace` calls earlier in this session had a malformed path attribute and silently failed. The seam, action, and tests were correct; only the JSX block was missing. Caught by the user when they opened an IGNORED article in `npm run web:dev` and saw no button. Fixed by amending the commit; tests still pass. Worth a glance when reviewing future PRs that touch `page.tsx`.

## Risks and concerns

- **Race against an in-flight cheap-filter sweep.** The seam is correct under concurrent re-queue clicks (`WHERE processing_status='IGNORED'` is the guard; second click matches zero rows and throws). Against an in-flight sweep that has already read its candidate list, the re-queued article is not in that list; the next sweep picks it up. Documented in the seam docstring; not blocking.
- **Loss of previous filter forensic trail.** Because the cheap-filter columns are wiped, an analyst cannot see "why was this previously ignored" after re-queue without `articles` history. Mitigation: `articles.processing_error` was the only human-readable trail anyway; if forensics matter later, the alternative (preserve columns + add `filter_requeue_count`) is a single migration.
- **Discoverability of IGNORED articles in the UI.** The action lives on the article detail page, but the Workspace has no "ignored articles" list — reaching one requires knowing the article ID. This matches the PRD's "escape hatch for a few recent misses" framing; a browse queue is a future ticket.
- **Server-action auth tests** are not added; the action uses the same `requireAnalyst` + redirect pattern already covered by existing workspace tests (per the agreed test scope).

## Test evidence

- `npm run check` — passes (`tsc --noEmit`).
- `npx vitest run --exclude tests/llmHelpers.test.ts` — 340 passed, 5 skipped, 0 failed.
- New tests `tests/article-requeue.test.ts` cover:
  - Successful re-queue wipes the cheap-filter columns and the ignore reason; sets `processing_status='NEW'`; the SQL carries the `WHERE id=$1 AND processing_status='IGNORED'` invariant.
  - Reject when article exists in any status other than IGNORED (zero-row update throws `ArticleNotIgnorableError`).
  - Reject when article does not exist.

## Follow-ups

- "Browse IGNORED articles" list on the Workspace (out of scope for #39; would unblock discoverability).
- Optional migration: add `filter_requeue_count INT` and `last_requeued_at TIMESTAMPTZ` columns to `articles` if forensic trail or telemetry become needed.
- Eval Inventory JSON dual-write (PRD #34 explicitly out of scope).

## Verdict

**Approve.** Spec is met; the only follow-ups are discoverability and optional telemetry, both safely deferred.