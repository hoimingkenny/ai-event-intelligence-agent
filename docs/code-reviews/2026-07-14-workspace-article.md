# Code Review: Workspace article page (#28)

- **Branch:** `feat/workspace-article-28` → `main`
- **Commits:** (pending)
- **Date:** 2026-07-14
- **Reviewer:** Auto (implement)

## Summary of change

Adds `getWorkspaceArticle` to the editorial read model and an analyst-gated `/workspace/articles/[id]` page with full body (`cleanText` → `rssSummary`), Filter signals + Extracted entities blocks, full LLM classification JSON, and pipeline meta. Needs triage titles link to the new page. Public `/articles/[id]` unchanged. Parent: [#28](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/28) / PRD [#26](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/26).

## Behaviour changes

- New workspace route; triage titles become links.
- No Create-event CTA, Human review forms, or alert QA on the page (by design).

## Risks and concerns

- Workspace article is loadable by id for any article in DB (not restricted to Needs triage). Analysts may bookmark past-triage articles; accepted for “workspace article” semantics.
- `generateMetadata` reads the article before auth in the page component order for metadata only — same pattern as other workspace pages; does not render body to unauthenticated users (page redirects).

## Test evidence

- `npm run check` — pass
- `tests/workspace-article.test.ts` + related editorial tests — pass
- Full suite excl. networked `llmHelpers` — 304 passed

## Follow-ups

- #29 Article peek drawer
- Optional: restrict detail loader to triage-eligible articles if desired later

## Verdict

**Approve** — #28 acceptance criteria met; metadata gated with `requireAnalyst` so unauthenticated callers do not trigger a full workspace article load.
