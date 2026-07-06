# Code Review: Events page in the portal (list → detail with timeline sources)

- **Branch:** `feat/portal-events` → `main`
- **Date:** 2026-07-05
- **Reviewer:** Claude

## Summary of change

Adds an Events view to the article portal (interview-clarified requirements: new tab in the existing portal; list → detail; each source row shows source + linked title + extracted-preview + published time, ordered as a timeline; multi-source events surfaced first).

- `src/portal/events-portal.ts` — read model: `loadEventsOverview` (default sort `source_count DESC` so corroborated events lead; filters: min-sources, severity, search; summary with a multi-source count) and `loadEventDetail` (event fields + its source articles ordered `published_at ASC` = first report → follow-ups).
- Server: `GET /api/events` and `GET /api/events/:id` added to the existing portal server.
- View: header nav (Articles | Events), an events table + detail panel, sources rendered as a **timeline** (first report / primary / material-update markers), and cross-navigation — an article-detail event chip jumps to the Events page and opens that event.

## Behaviour changes

- Portal gains an Events tab and two read-only endpoints; page title is now "Threat Watch Portal". No schema, no pipeline change.

## Risks and concerns

- **Multi-source depends on grouping quality.** `source_count` and the source list are only as good as the event-grouping ladder; a mis-grouped article would appear as a wrong source. This surfaces grouping quality rather than causing it — arguably a feature (the page makes grouping visible).
- **Severity sort uses `array_position` over a fixed literal array** (not user input) — safe; all user filters are parameterized.
- **Detail issues 2 queries per open** (event + sources) — fine for a human-driven tool.
- Sources ordered by `published_at ASC NULLS LAST`; articles missing a published date sort last, not into the timeline position — acceptable, and `fetched_at` is the tiebreaker.
- XSS: all values escaped in-client / server-escaped; the only links are the source's own canonical URL (opened with `rel="noopener"`) and the same-origin extracted-preview route.

## Test evidence

- `npm run check` clean; `vitest` 144 passed / 4 skipped (3 pre-existing MiniMax network failures only). 4 new tests: overview list + multi-source summary, min-sources filter, detail with timeline-ordered sources (primary/material-update flags), missing-event null.
- HTTP smoke test against a stub DB: `/api/events` 200, event detail 404 on missing, home page contains the Events nav + timeline styles.

## Follow-ups

Deep-linkable event URLs (`#/event/:id`) for sharing; a per-event alert history tab; optional map from event back to its alerts.

## Verdict

**Approve.** Delivers the clarified requirement — browse events, drill into one, see its sources as a timeline with multi-source events first — reusing the established data/server/view pattern with parameterized queries and escaped rendering.
