# Code Review: Article monitoring portal

- **Branch:** `feat/articles-portal` → `main`
- **Date:** 2026-07-05
- **Reviewer:** Claude

## Summary of change

Adds a read-only web portal (`npm run portal`, `:4322`) for monitoring every article: a filterable/sortable/searchable table of status, extraction status, content-quality score, RSS recall, and clean-text length, with header metrics (totals, median quality/recall, extraction failure rate). Clicking a row opens a detail panel with the full scores, extracted entities (with confidence), grouped events, alerts, and a tabbed preview — the **extracted article text** rendered as a reader view, the RSS summary, and the LLM classification JSON.

Structure mirrors the existing review server: a pure data module (`articles-portal.ts`), an HTTP server (`articles-portal-server.ts`), and a single-file framework-free HTML/JS view (`articles-portal-view.ts`). Distinct from the human-review dashboard (which captures verdicts) — this is a browse/inspect surface.

## Behaviour changes

- New `npm run portal` and a localhost-bound `portal` compose service (depends on migrate).
- Read-only: only GET routes (`/`, `/api/articles`, `/api/articles/:id`, `/api/articles/:id/preview`); no mutation endpoints. No migration.

## Risks and concerns

- **XSS surface** (article titles/URLs/extracted text are third-party content): all values are inserted via `textContent`/escaped in the client and server-escaped in the reader preview; the extracted-text preview renders inside a `sandbox=""` iframe (no scripts, no same-origin). Verified in tests.
- **No auth** — same posture as the review dashboard; bound to `127.0.0.1`. Add auth before any non-local exposure (Pillar 5). The `PORTAL_HOST=0.0.0.0` in compose is still published only to `127.0.0.1` on the host.
- **`loadDistinct` interpolates a column name** — it is a fixed literal never derived from user input; all user-facing filters are parameterized.
- Detail panel issues a few queries per open; fine for a human-driven inspection tool, not a hot path.

## Test evidence

- `npm run check` clean; `vitest` 140 passed / 4 skipped (3 pre-existing MiniMax network failures only).
- 6 new tests: overview list/summary/filters, failure-rate computation, detail assembly with numeric coercion, missing-article null, HTML escaping, portal shell wiring (asserts the sandboxed preview).
- HTTP smoke test against a stub DB: `/` 200 html, `/api/articles` 200, detail/preview 404 on missing — confirmed during development.

## Follow-ups

Auth before non-local use; pagination controls in the UI (API already supports limit/offset); a raw-HTML preview tab (raw_html is stored) once retention policy (Pillar 8) decides how long it is kept.

## Verdict

**Approve.** A useful read-only operator surface built on the established data/server/view pattern, with the third-party-content XSS risk handled by escaping + a sandboxed preview and covered by tests.
