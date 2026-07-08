# Merge Review and Eval Dashboards

## Implementation note

Implemented with two pragmatic clarifications:

- The merged dashboard has three top-level operator surfaces: **Human review**, **Cheap-filter eval**, and **LLM evaluation**. The LLM evaluation surface remains first-class rather than being folded invisibly into either review or eval.
- New eval API routes live under `/api/eval/*`, but the merged server also accepts the old `/api/candidates`, `/api/labels`, `/api/decisions`, `/api/labels/from-article`, `/api/inventory`, and `/api/report` paths as compatibility aliases.
- Cross-pane article selection is supported by `articleId` query parameters and a shared browser message between the review pane and the eval pane. If the selected article is outside the current list, the server prepends it to the response when it exists.

## Addendum — architecture pivot (iframe → inlined shell)

The initial implementation took a pragmatic iframe shortcut for the eval pane: the merged dashboard served the eval HTML doc from `GET /eval` and loaded it inside `<iframe id="eval-shell">`, with cross-pane article selection bridged via `window.postMessage({ type: 'vendor-threat-watch:selected-article', … })`. This got step 4 (route mount) over the finish line quickly, but it diverged from the inlined design in step 5 of this plan.

A subsequent PR (`feat/cheap-filter-eval-workflow`, see the floating-baking-snail plan) reverted to the original architecture:

- `src/review/eval/eval-page.ts` exposes `evalPaneStyles()`, `renderEvalPane()`, `evalPaneBodyScript()`, and `defaultEvalPaneState()` as composable exports, with `renderEvalReviewApp()` continuing to serve the standalone eval HTML doc (used by tests and a future debug surface).
- `renderReviewApp()` inlines the eval pane HTML/CSS/JS directly into the same document. No `<iframe>`, no `postMessage`. Cross-pane selection is a direct mutation of the shared `state.eval.selectedArticleId` ↔ `state.human.selectedId`.
- DOM IDs were namespaced (`eval-tab-*`, `eval-refresh`) so the two panes can co-exist in one DOM without colliding.
- The `GET /eval` route and the `vendorThreatWatchSelectedArticleId` global are gone.

LLM evaluation remains a sub-tab of the Cheap-filter eval pane in the current implementation; promoting it to a third top-level surface alongside Reviews / Cheap-filter eval is still an explicit follow-up.

## Goal

Collapse `npm run review:dashboard` (`:4321`) and `npm run eval:review` (`:4323`) into a single server, single URL, single HTML page with a top-level tab nav. Same workflows, same data, same persistence — just one process and one place to point operators at.

The motivation is operational: the same person does both jobs, and the cheapest path between "I just reviewed this article and noticed the cheap filter mis-scored it" and "I want to label it for the eval set" should be a tab switch, not a different tab in the browser.

## Non-goals

- **No new auth.** Still assumed to live in Caddy / Cloudflare Access in front of the process.
- **No shared component library.** Each view still hand-rolls its UI. If a fourth surface lands, revisit.
- **No unification of the verdict data model.** `human_review_verdicts` (5-field pipeline-output review) stays distinct from `cheap-filter-eval.jsonl` (single 4-class label). The two are different artefacts for different purposes — the LLM eval layer already joins them at the report level, which is enough.
- **No migration of persisted data.** `cheap-filter-eval.jsonl`, `monitored-vendors.json`, `human_review_verdicts` rows all stay where they are. We're consolidating HTTP entry points, not data stores.
- **No change to the LLM eval layer.** Its endpoints live on the review dashboard already and stay there.

## Current state

Two independent Node HTTP servers:

| | `:4321` (review) | `:4323` (eval) |
|---|---|---|
| File | `src/review/human-review-server.ts` | `eval/server/eval-review-server.ts` |
| View | `human-review-server.ts:renderReviewApp()` (inline) | `eval/server/eval-review-page.ts` (separate file) |
| Source of truth | Postgres only | JSONL + `monitored-vendors.json` + (optional) Postgres |
| Routes | `GET /`, `GET /api/review-cases`, `GET /api/llm-evaluations`, `POST /api/reviews` | `GET /`, `GET /api/candidates`, `POST /api/labels`, `GET /api/decisions`, `POST /api/labels/from-article`, `GET /api/inventory`, `POST /api/inventory`, `GET /api/report` |

Both bind `127.0.0.1`, both render server-side HTML, both share the same architectural pattern (vanilla `node:http`, hand-rolled UI). See [UI and Dashboards](../design/ui-and-dashboards.md) for the deeper survey.

## Target architecture

### One process

Move the eval server's logic into `src/review/`. New layout:

```text
src/review/
  human-review-server.ts       # was: review-dashboard server. Now also routes /api/eval/*
  human-review-dashboard.ts    # existing data loader + static HTML renderer
  llm-evaluation-dashboard.ts  # unchanged
  eval/
    eval-data-loader.ts        # new: extract cheap-filter-eval data access from eval/server/eval-review-server.ts
    eval-page.ts               # was: eval/server/eval-review-page.ts — view moved here
    eval-routes.ts             # new: route handlers for /api/eval/* (was inline in eval-review-server.ts)
    index.ts                   # new: barrel re-export
eval/server/                    # DELETED — content moved into src/review/eval/
```

Keep the eval scripts in `eval/scripts/` and `eval/utils/` where they are. Only the HTTP server moves.

### One HTML page, one shell

The existing `renderReviewApp()` becomes a thin shell:

```html
<header>
  <nav>
    <a data-tab="reviews">Reviews</a>
    <a data-tab="eval">Cheap-filter eval</a>
  </nav>
</header>
<main>
  <section id="reviews-pane">…review dashboard content…</section>
  <section id="eval-pane">…eval review content…</section>
</main>
```

Tab switching is `display: none` toggling, same pattern the eval review already uses for its inner tabs. The eval review's *internal* tabs (Label candidates / Live decisions / Report / Inventory) become nested tabs inside the eval pane. Inventory is the odd one out — see "Inventory placement" below.

### One shared "selected article" pointer

A single in-memory `state.selectedArticleId`. When a reviewer picks an article in the Reviews pane, that article becomes the selected one in the Eval pane. They can pivot without losing context. Same in reverse: if they pick an article in Live decisions and switch to Reviews, the review detail pane jumps to that article.

The shared pointer applies to article-detail state. List state (sidebar scroll position, applied filters, pagination cursor) stays per-pane — those are independent concerns.

### Route map

All routes stay under `/api`. Add `/api/eval/` prefix to the eval routes so they sit cleanly next to `/api/reviews` and don't collide with anything new.

| Old | New |
|---|---|
| `GET /` (`:4321`) | `GET /` (merged) |
| `GET /api/review-cases` | `GET /api/review-cases` (unchanged) |
| `GET /api/llm-evaluations` | `GET /api/llm-evaluations` (unchanged) |
| `POST /api/reviews` | `POST /api/reviews` (unchanged) |
| `GET /` (`:4323`) | *(removed; served by merged `GET /`)* |
| `GET /api/candidates` | `GET /api/eval/candidates` |
| `POST /api/labels` | `POST /api/eval/labels` |
| `GET /api/decisions` | `GET /api/eval/decisions` |
| `POST /api/labels/from-article` | `POST /api/eval/labels/from-article` |
| `GET /api/inventory` | `GET /api/eval/inventory` |
| `POST /api/inventory` | `POST /api/eval/inventory` |
| `GET /api/report` | `GET /api/eval/report` |

The eval-route prefix change is a one-time URL rename. There are no external consumers (internal tooling only), and a `grep` for the old paths will catch any stragglers.

## Inventory placement

Currently the Inventory tab is nested inside the Eval review because the eval loop edits the inventory. After the merge that placement feels off — inventory is a pipeline-wide config (vendor detection happens at extraction, classification, dedup), not an eval artefact.

Two options:

- **A.** Keep Inventory nested inside the Eval pane. Lowest-churn migration. Inventory is reachable from `Eval → Inventory` as today.
- **B.** Promote Inventory to a top-level tab: `Reviews | Eval | Inventory`. The eval pane drops its Inventory tab.

Option B is the right long-term answer but is strictly more change for this pass. Recommendation: ship Option A in the merge PR, leave Option B as a follow-up.

## Shared data loader

There's one real DRY win here. The review dashboard loads article-level data; the eval review's Live Decisions loads article-level data; the cheap-filter eval's `expectedSignals` derivation runs on the same article shape. Extract a thin `loadArticleEvalContext(articleId)` in `src/review/eval/eval-data-loader.ts` that returns:

```ts
{
  article: { id, title, url, rssSummary, rssCategories, sourceName, sourceTier, publishedAt, processingStatus },
  cheapFilter: { decision, score, reasons, blockingReasons, matchedSignals },
}
```

Used by:
- Live Decisions tab (replaces the inline SELECT in `eval-review-server.ts:listFilterDecisions`)
- LLM eval bridge (the `/api/llm-evaluations` route can join on this if it needs to enrich)

Keeps the per-route queries small and consistent. Don't go further than this — there's a temptation to also unify with the review dashboard's full article loader, but that pulls in events/entities/alerts/audit and conflates two different concerns.

## Migration steps

Each step is independently mergeable. Cut over between steps 4 and 5 — before that, both servers run; after, only the merged server does.

1. **Create the `src/review/eval/` module.** Move `eval/server/eval-review-server.ts` and `eval/server/eval-review-page.ts` into `src/review/eval/`. Split the server file into `eval-routes.ts` (route handlers) and `eval-data-loader.ts` (data access). Add barrel `index.ts`. Pure refactor, no behaviour change. Verify `npm run check` and `npm test` pass.

2. **Add `/api/eval/` prefix in `eval-routes.ts`.** Internal rename only. Update the page's fetch URLs to match. Run `npm run eval:review` and verify the four tabs work.

3. **Add shared `loadArticleEvalContext` in `eval-data-loader.ts`.** Replace the inline SELECT in `listFilterDecisions` with the new loader. No behaviour change.

4. **Mount eval routes into the review server.** Update `human-review-server.ts` to register the eval routes under `/api/eval/*` and to serve `renderEvalApp()` at a sub-route during dev. At this point you can `curl localhost:4321/api/eval/candidates` and get the same response `localhost:4323` would have given. The two servers still both run.

5. **Build the merged HTML shell.** Update `human-review-server.ts`'s inline `renderReviewApp()` (or extract it to a new `review-page.ts` view module) to emit the tab nav and the eval-pane container. Move `renderEvalApp()` into a partial that gets injected into the shell. At this point both servers still run, but the merged page can be served from `:4321`.

6. **Wire the shared `state.selectedArticleId`.** Add to both panes' render paths. When either pane sets it, the other re-renders its detail header from the same ID (or stays on its previous selection if the ID isn't visible in its list).

7. **Cut over.** Delete `eval/server/`. Delete `scripts/serve-eval-review.ts`. Update `package.json`: `eval:review` script becomes a deprecation shim that prints `use npm run review:dashboard` and exits 0, OR remove it entirely. The eval scripts in `eval/scripts/` (run-cheap-filter-eval, harvest-candidates, validate-dataset, import-manual-articles) stay — they don't depend on the HTTP server.

8. **Delete the eval-review route handling from `package.json` and update README.** Drop `eval:review` (or shim it). Update the eval workflow docs to point at the merged UI.

## Risks

- **Two processes running simultaneously during the migration.** Steps 1–4 keep both servers alive so the eval UI doesn't break mid-migration. The hard cut is step 7. Don't ship step 7 without verifying step 5 renders identically on `:4321`.

- **JSONL file lock contention.** The eval review's `/api/eval/labels` appends to `cheap-filter-eval.jsonl` via `appendFile`. The current single-process model has no lock. The merged server is still single-process so this is unchanged — but if we ever scale to multiple replicas, this becomes a real race. Flagging now; not blocking.

- **`monitored-vendors.json` concurrent edits.** Same issue: `POST /api/eval/inventory` does `writeFileSync` of the whole file after validating. If two operators edit simultaneously, last-write-wins. Same as current behaviour. Worth fixing when more than one person uses the dashboard; not in this pass.

- **Route prefix rename breaks muscle memory.** Operators who have `localhost:4323/...` open in their browser tabs will hit a dead endpoint after step 7. Add a one-line 301 from `/api/candidates` (and friends) to `/api/eval/candidates` in `human-review-server.ts` for one release, then remove. Or just communicate the change. I lean toward "communicate, don't shim" — the eval review is internal and the rename is clean.

- **Inventory placement decision.** Option A (keep nested) means the merge doesn't unlock the structural improvement of treating Inventory as pipeline-wide config. Acceptable trade-off for a smaller PR.

- **Tab-pane render order.** If both panes' render code calls `innerHTML =` on mount, the second pane's render might overwrite the first's container. Test step 5 carefully. The eval review already deals with this internally for its tabs (it uses one render path that switches on the active tab), so a similar pattern is available.

## Acceptance criteria

- `npm run review:dashboard` serves a single page with a top-level tab nav (Reviews / Cheap-filter eval).
- `npm run review:dashboard` exposes `/api/review-cases`, `/api/llm-evaluations`, `/api/reviews`, and the renamed `/api/eval/*` routes. All previously existing clients of these routes (the static snapshot script, the test suite, the docs) still work.
- The eval-review workflows (label candidates, live decisions, report, inventory) function identically after the merge.
- The human-review workflows (case list, verdict capture, LLM eval sidebar) function identically after the merge.
- A reviewer can select an article in one pane, switch tabs, and see that same article preselected in the other pane (or the pane gracefully falls back if the article isn't visible in its list).
- `eval/server/` is deleted.
- `npm run eval:review` is removed or shimmed with a clear deprecation message.
- `npm run check`, `npm test`, and a manual smoke pass on each tab all pass.

## Explicitly deferred

- **OIDC / per-reviewer audit.** Different problem. See the deployment discussion — needs `human_review_verdicts` to grow a `reviewer_id` column with auth claims, not a UI merge.
- **Real-time updates.** Both surfaces currently refetch on user action. SSE / WebSocket is a separate design.
- **Inventory promotion to a top-level tab.** See "Inventory placement" — option B is a follow-up.
- **JSONL / file-lock hardening.** Needed before any kind of multi-replica deploy. Separate concern.
- **Refactoring the verdict + label data models.** They measure different things. Keep separate.
- **Replacing the per-view hand-rolled UIs with a shared component library.** Premature until a fourth surface lands.

## Open questions

- Does the merged dashboard want a `/api/me` endpoint so the UI can render the current reviewer name without a free-text input? That'd let `HumanReviewSubmissionSchema.reviewer` come from auth claims instead of a form field.
- Do we want a "label this article for the eval" button inside the review detail pane? That'd be the literal one-click workflow this merge is meant to enable. If yes, add `POST /api/eval/labels/from-article` as a button in the review detail pane and pre-fill the article ID.
- After cutover, what's the canonical name for the merged dashboard? `npm run review:dashboard`? `npm run review`? `npm run dashboard`? Worth a five-minute decision before step 8.
