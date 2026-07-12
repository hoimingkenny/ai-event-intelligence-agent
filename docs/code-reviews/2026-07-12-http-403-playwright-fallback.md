# Code Review: HTTP 403/429 retry + Playwright escalate

- **Branch:** `feat/diagnose-sailpoint-event-split` → `main`
- **Commits:** `805ba19` (extraction follow-up; embedding lifecycle already reviewed in `2026-07-12-embedding-lifecycle.md`)
- **Date:** 2026-07-12
- **Reviewer:** Cursor agent

## Summary of change

SecurityWeek (and similar WAF-y publishers) intermittently return HTTP 403 to Node `fetch`, which is not a browser. This change keeps HTTP as the default path, retries **403/429** a bounded number of times with browser-like headers, then escalates only those block failures to **Playwright**. Other HTTP failures (short/noisy body) still fail loud without Playwright. Supporting tooling: `db:reset` / `db:reset:manual`, and `process.exit` on one-shot `pipeline:run` so LLM keep-alive sockets do not hang the CLI.

## Behaviour changes

- Default `ExtractionRouter` now constructs a Playwright fallback (was `null`). Pass `fallbackExtractor: null` to disable.
- Playwright uses the same browser-like User-Agent as HTTP and runs Readability on `page.content()`.
- `HttpArticleExtractor` retries only on `HTTP 403` / `HTTP 429` (default 2 attempts).
- Operators need Chromium for the fallback path: `npx playwright install chromium`.
- `npm run db:reset -- --yes` drops schema `app` (destructive; gated on `--yes`).

## Risks and concerns

- **Playwright cost/latency** on every persistent 403/429 — accepted; scoped to block statuses only, not all `http_failed`.
- **Headless Chromium still blocked by some WAFs** — possible; then article stays failed (correct: no RSS bypass).
- **Browser process lifecycle** in long-running scheduler — extractor holds a shared browser; monitor for leaks under sustained load.
- **`db:reset` is destructive** — mitigated by required `--yes`.

## Test evidence

- `npm run check` — pass
- `npx vitest run tests/extraction.test.ts` — 8 passed (headers, 403 retry, no-retry on 500, escalate only on 403, no escalate on short body)
- Live: forced HTTP 403 → `playwright_success` on SecurityWeek SailPoint URL (~1616 clean chars)
- End-to-end after `db:reset:manual` + pipeline: 1 SailPoint event with SecurityWeek + SC Media + Security Affairs; SecurityWeek `playwright_success` / `CLASSIFIED`

## Follow-ups

- Ollama attach/uncertain threshold calibration (diagnose harness ~0.151 vs 0.15)
- JS-empty HTTP 200 shells still do not escalate to Playwright
- Optional: close Playwright browser between scheduler ticks
- Do not commit `eval/datasets/manual-articles copy.jsonl` (local junk)

## Verdict

**Approve.** Matches the locked decision (no 403 bypass; Playwright after bounded block retries) with tests and a live cluster proof; residual risks are operational and documented.
