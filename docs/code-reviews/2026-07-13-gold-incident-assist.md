# Code Review: Gold incident assist in Grouping eval

- **Branch:** uncommitted on `main` (recommend `feat/gold-incident-assist` before merge)
- **Commits:** working tree (not yet committed)
- **Date:** 2026-07-13
- **Reviewer:** Cursor agent
- **Spec:** [#8 Gold incident assist in Grouping eval](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/8), `docs/adr/0002-gold-incident-assist.md`

## Summary of change

Adds eval-only **gold incident assist**: `POST /api/grouping-eval/assist` loads 2–5 DB articles with `cleanText`, calls a dedicated LLM prompt/schema, and returns per-article briefs plus a same-event recommendation and suggested name. The Grouping eval UI gets an Assist button, draft panel, and “Apply name”; gold is still written only via the existing Save/upsert path. Also includes gold-incident DELETE (route + sidebar ×) and updated SharePoint gold basket IDs in the eval dataset.

## Behaviour changes

- New route `POST /api/grouping-eval/assist` — draft JSON only; no gold write.
- Grouping eval Gold incidents builder: Assist button + draft panel; delete gold incident control.
- `eval/datasets/grouping-gold-incidents.jsonl`: SharePoint basket re-ID’d (articles 4–6) and SailPoint renamed.
- `CONTEXT.md`: glossary entry for **Gold incident assist**.
- No changes to production event grouping / `compareArticleToEvent`.

## Risks and concerns

- **Assist on loaded existing incident** — Save can upsert when `selectedIncidentId` is set; issue #8 defers “add-to-existing-basket” for v1 but does not forbid editing a selected incident via Save. Low risk if operators follow “New gold incident” workflow.
- **Duplicate `articleIds` in request** — route dedupes with `Set`; `['1','1','2']` passes validation but assists with two articles silently.
- **Stale assist draft** — `startNewIncident` / incident selection do not clear `#grp-assist-draft`; old briefs can linger after basket changes.
- **Null LLM recommendation → `mixed`** — lenient coercion may mask a bad model response rather than failing loud; accepted for eval UX resilience.
- **Eval schemas in `src/llm/schemas.ts`** — increases coupling between eval assist and production schema module; acceptable for PoC, revisit if eval grows.

## Test evidence

- `npm run check` — pass
- Scoped assist tests (4 files, 21 tests) — pass
- Full suite: 261 passed; 2 failures in `tests/llmHelpers.test.ts` (live MiniMax network — pre-existing, unrelated)

## Follow-ups

- ~~Clear assist draft on basket/incident change~~ — done.
- ~~Remove debug `console.log('[assist] articleIds', …)`~~ — done.
- Reject duplicate `articleIds` in assist request (400 `ARTICLE_COUNT`).
- Show extraction status (`has cleanText`) on article picker hits.
- Move eval-only Zod preprocessors closer to `gold-incident-assist.ts` if `schemas.ts` grows further.

## Standards

| Finding | Severity |
|---------|----------|
| Missing merge-gate doc before this review | Fixed by this file |
| Eval assist types/preprocessors in `src/llm/schemas.ts` | Note — divergent change smell |
| `loadArticlesForAssist` in `score-pairs.ts` | Note — wrong seam, works |
| Duplicated 2–5 bounds (UI, route Zod, `validateAssistArticles`) | Note — acceptable |
| Duplicated brief-mismatch checks in `pickBriefsForArticles` / `mergeAssistDraft` | Note |
| Debug `console.log` in eval UI | Minor — remove |
| Shallow UI test (markup only) | Note — matches “cheap integration” intent |
| Legacy import `src/agents/llmHelpers` in eval module | Pre-existing pattern |

## Spec (#8 + ADR-0002)

| Requirement | Status |
|-------------|--------|
| Dedicated prompt/schema, not production comparator | Met |
| 2–5 articles, refuse missing `cleanText` | Met |
| Draft only on `/assist`; gold via Save | Met |
| Injectable LLM caller + route seam | Met |
| No assist transcript persistence | Met |
| UI in Gold incidents builder | Met |
| DB article picks only (no paste-URL) | Met |
| v1 create-new only | Partial — Save still upserts when incident selected |
| DELETE gold incident | Scope creep (useful, not in #8) |
| JSONL dataset edits | Operational data, not feature code |

## Verdict

**Approve-with-notes** — core assist flow matches #8 and ADR-0002; human remains gold authority; tests cover the seam without live MiniMax. Address debug log and stale-draft UX before merge; optionally gate Assist when editing an existing incident or split DELETE into a separate PR.
