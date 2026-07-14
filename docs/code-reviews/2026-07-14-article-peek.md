# Code Review: Article peek drawer (#29)

- **Branch:** `feat/article-peek-29` → `main`
- **Commits:** `d1f95ce`
- **Date:** 2026-07-14
- **Reviewer:** Auto (implement)

## Summary of change

Adds `getArticlePeek` / excerpt + compact LLM digest helpers to the editorial read model, an analyst-gated fetch-on-open route at `/workspace/api/articles/[id]/peek`, and a Phosphor magnifier + right slide-over on Needs triage. Title links remain Workspace article navigation; list SSR stays slim. Parent: [#29](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/29) / PRD [#26](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/26).

## Behaviour changes

- New magnifier opens Article peek without leaving triage.
- Peek payloads are not embedded in the triage list response.

## Risks and concerns

- Peek API is under `/workspace/…` so middleware + `requireAnalyst` apply; `getArticlePeek` itself remains an ungated read model (same pattern as `getWorkspaceArticle`).
- Client drawer uses `useTransition` for fetch; Escape / backdrop close supported.

## Test evidence

- `npm run check` — pass
- `tests/article-peek.test.ts` — excerpt, digest, slim list assertions
- Full suite excl. networked `llmHelpers`

## Follow-ups

None for #29; PRD slice complete.

## Verdict

**Approve** — #29 acceptance criteria met at the editorial seam and triage UI.
