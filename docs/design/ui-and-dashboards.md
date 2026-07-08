# UI and Dashboards

Two Node HTTP servers ship with the project. All are deliberately thin: vanilla `node:http`, no framework, no build step, one HTML response at `/` plus a JSON API. The UI is hand-written `innerHTML` rebuilt from a single in-memory `state` object on every load — there is no client framework, no virtual DOM, no hydration. Each server owns its own data layer and renders its own view module.

This shape was chosen for one reason: zero client-side dependencies means the dashboards can be regenerated, audited, and shipped as a single static file if we want to. It costs us any sense of component composition or shared styling.

## Surfaces

| Server | Port | npm | Read/Write | Purpose |
|---|---:|---|---|---|
| Articles + events portal | 4322 | `npm run portal` | read-only | Browse ingested articles, extraction quality, events. The candidate for a public-facing read view. |
| Merged review dashboard | 4321 | `npm run review:dashboard` | read + write verdicts + eval labels | Review pipeline output, inspect LLM judge runs, label cheap-filter eval samples, browse live filter decisions, run eval reports, edit monitored-vendor inventory. |

Each binds to `127.0.0.1` by default. Caddy/nginx in front is the right way to expose any of them — they have no auth layer of their own.

## Articles portal (`src/portal/`)

```
src/portal/
  articles-portal-server.ts   # 166 lines — HTTP routes
  articles-portal.ts          # data loader for /api/articles
  articles-portal-view.ts     # 359 lines — HTML view
  events-portal.ts            # data loader for /api/events
```

Routes:

```text
GET  /                                          -> renderPortalApp()
GET  /api/articles                             -> loadArticlesOverview(query)
GET  /api/articles/:id                         -> loadArticleDetail(id)
GET  /api/articles/:id/preview                 -> standalone reader HTML (clean_text, escaped)
GET  /api/events                               -> loadEventsOverview(query)
GET  /api/events/:id                           -> loadEventDetail(id)
```

The `/preview` route is interesting: it renders the article's `clean_text` as a standalone HTML doc, not as part of the SPA. That exists so a reviewer can hit a single article's full extraction in a tab without dealing with the portal's chrome. The server-side HTML escapes everything; the extracted text was already boilerplate-filtered at extraction time.

The portal deliberately exposes nothing that mutates state. It's the only surface that has a credible "public" deployment story — but "public" still means "what we want a vendor or partner to be able to see", not "open internet with no rate limit".

## Merged review dashboard (`src/review/`)

```
src/review/
  human-review-server.ts       # HTTP routes + renderReviewApp() — single HTML doc with two panes
  human-review-dashboard.ts    # data layer + Zod schemas + static HTML renderer
  llm-evaluation-dashboard.ts  # LLM-audit rollups for the review sidebar
  eval/
    eval-routes.ts             # cheap-filter eval JSON API + standalone test server helper
    eval-page.ts               # composable eval pane (styles, body HTML, init script)
```

The dashboard is one HTML document. `renderReviewApp()` inlines the eval pane's HTML, CSS, and JS directly into the same response — no `<iframe>`, no `postMessage`. Top-level tabs toggle `#review-pane` and `#eval-pane` via the `hidden` attribute. Cross-pane article selection is a direct mutation of the shared `state` object: `state.human.selectedId` ↔ `state.eval.selectedArticleId`. The eval pane is still exported as a self-contained HTML doc via `renderEvalReviewApp()` for the standalone factory and a future debug surface.

Routes:

```text
GET  /                                  -> renderReviewApp()
GET  /api/review-cases?limit&articleId  -> loadHumanReviewDashboard(db, limit, articleId)
GET  /api/llm-evaluations?limit=20      -> loadLlmEvaluationDashboard(db, {limit, runId})
POST /api/reviews                       -> HumanReviewSubmissionSchema -> saveHumanReviewVerdict
GET  /api/eval/candidates               -> pending labeling candidates
POST /api/eval/labels                   -> append a label to cheap-filter-eval.jsonl
GET  /api/eval/decisions                -> articles with a cheap_filter_decision
POST /api/eval/labels/from-article      -> label a live article directly into the eval set
GET  /api/eval/inventory                -> monitored-vendors.json (read)
POST /api/eval/inventory                -> monitored-vendors.json (replace, hot-reload)
GET  /api/eval/report                   -> evaluateCheapFilterDataset(samples)
```

The old eval API paths (`/api/candidates`, `/api/labels`, `/api/decisions`, `/api/labels/from-article`, `/api/inventory`, `/api/report`) are accepted by the merged server as compatibility aliases. New code should use `/api/eval/*`.

Hard limits worth knowing:

- `MAX_REVIEW_CASE_LIMIT = 200` — the sidebar list cap.
- `MAX_JSON_BODY_BYTES = 64 KB` — verdict submissions.
- Verdict schema is `HumanReviewSubmissionSchema` (Zod). 5 verdict fields per article (`relevanceVerdict`, `vendorImpactVerdict`, `llmClassificationVerdict`, `groupingVerdict`, `alertVerdict`), each `not_reviewed | correct | incorrect | unclear`. Plus reviewer name and free-text notes.
- Verdicts are append-only. Each save inserts a new `human_review_verdicts` row. `loadHumanReviewDashboard` uses `DISTINCT ON (article_id)` to pick the latest row per article.

A separate static-snapshot path exists at `scripts/run-human-review-dashboard.ts` (`npm run review:report`) that renders the same dashboard into `review/human-dashboard/index.html` for read-only sharing or git diffs. The committed snapshot uses inert checkboxes labeled "this is read-only" — it cannot capture verdicts.

The `/api/llm-evaluations` route was added when the LLM eval layer landed so reviewers can see, per article, what the offline judge said and where it disagreed with the deterministic filter. This is the bridge between the cheap-filter eval pipeline and the human review loop — the place where LLM judgments become actionable.

Hard limits:

- `MAX_JSON_BODY_BYTES = 512 KB` — inventory replacement can be large.
- `MAX_DECISION_LIMIT = 200` — the live decisions tab caps at 200 rows.
- Label submission requires a 4-class enum + `humanReason` ≥ 3 non-whitespace characters.
- Inventory POST validates the entire payload via `parseVendorInventory` (Zod) before writing.
- Duplicate URL guard: `/api/labels` returns 409 if the candidate URL is already in the labelled set.

The eval pane is the only dashboard path that does file I/O on the host: it mutates `config/monitored-vendors.json` and appends to `eval/datasets/cheap-filter-eval.jsonl`. Both paths are read from disk on every request — there is no in-memory cache — but the in-memory `monitoredVendors` array is mutated in place so a running pipeline picks up new aliases without a restart. The scheduler/worker still need a restart to pick up new vendor rows in the DB; `npm run seed:vendors` is the canonical way to re-sync the DB copy.

Five tabs in the eval pane (the **Cheap-filter eval** top-level tab contains all five):

1. **Label candidates** — primary labelling flow. The dataset of harvested candidates.
2. **Live decisions** — same labelling flow but reading from `articles.cheap_filter_decision` (Postgres). `--no-db` flag disables this tab.
3. **Report** — calls `/api/report` to compute the deterministic eval against the current labelled set. Renders confusion matrix, gate pass/fail, recommended actions, per-sample failure drill-down.
4. **LLM evaluation** — per-article rollups of offline judge runs from `/api/llm-evaluations` (the bridge between the deterministic filter and the human review loop). Nested rather than promoted to a third top-level tab — see `docs/plans/merge-review-and-eval.md` for the deferred promotion.
5. **Inventory** — editable table of monitored vendor products with search, criticality filter, row-level Edit/Delete, paste-JSON-to-append, and a copy-pasteable LLM prompt template for batch generation.

## Shared patterns

A few patterns repeat across both servers, deliberately:

- **No client framework.** The UI is one HTML file that fetches JSON and rebuilds via `innerHTML =`. The state is a single mutable object. There is no router — tabs are `display: none` toggles.
- **Server-rendered HTML.** Every page load is a `text/html` response from the Node process. The `/preview` route on the articles portal is the same pattern applied to extracted article text.
- **Localhost bind.** Every server defaults to `127.0.0.1`. Anyone who wants to expose one has to put it behind a reverse proxy, which is the right place to enforce TLS, auth, and rate limits.
- **Zod at the boundary.** Every POST handler parses JSON with a Zod schema and lets it throw on bad input. No silent coercion. The 400 / 409 / 500 error shapes are deliberately small (`{ error: { code, message } }`).
- **Append-only writes.** Verdicts, labels, LLM eval rows, inventory edits — all append or replace, never update-in-place. The DB is the source of truth; the JSONL files are append-only logs.
- **One process per operational surface.** The review and eval workflows now share `npm run review:dashboard`; the read-only portal remains separate. There is no shared HTTP framework or middleware layer.

## Things that are not here

- No authentication in either server. Plan to put any exposed surface behind Caddy + Cloudflare Access or similar.
- No WebSocket / SSE. The dashboards re-fetch on user action only; nothing live-updates. If you want real-time, that's a different design.
- No client-side routing. Each "tab" is a separate render path inside one HTML page; deep links aren't a thing.
- No build step. The HTML is committed to disk and shipped verbatim. CSP / nonce handling is therefore static — no inline scripts unless explicitly allowed.
- No shared UI primitives (button, modal, table). Every surface reimplements them inline. Worth keeping as-is until another operational surface forces the question.

## Deployment surface

See the discussion in the conversation thread — short version: portal at `:4322` is the only candidate for a public hostname, and only after putting it behind a rate limit and an explicit content policy. The merged review dashboard must stay behind auth and is not safe to expose even with auth unless `config/monitored-vendors.json` is moved off the host and behind an API that takes a file lock — right now the eval pane writes that file directly via `writeFileSync`, which is correct for a single-user localhost tool but wrong the moment two replicas or two reviewers can hit it concurrently.
