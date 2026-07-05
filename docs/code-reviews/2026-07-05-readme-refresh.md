# Code Review: README refresh

- **Branch:** `docs/readme-refresh` → `main`
- **Date:** 2026-07-05
- **Reviewer:** Claude

## Summary of change

Docs-only. Rewrites the top-level `README.md`, which had drifted badly from the implemented system: it described a "web search" MVP flow (steps 1–9 including "Run web search") that no longer exists, listed OpenAI Agents SDK, Qdrant, and `playwright:install` as current parts of the stack (all superseded or disabled), and omitted the real pipeline, the scheduler, the review dashboard, the local test source, and the watchdogs.

New README covers: the design principle, the actual stage-by-stage pipeline flow with the state machine, the current tech stack, quick start, continuous running (scheduler / Docker), and a full testing section (local test source walkthrough, unit tests, eval, drift/latency checks, dashboard, fixtures), plus psql inspection and pointers into `docs/`.

## Behaviour changes

None — documentation only.

## Risks and concerns

The README now asserts specific commands and script names; all were verified to exist in `package.json` (`scheduler`, `test-source:serve`, `review:dashboard`, individual stage scripts). The "~130 tests" figure will drift over time — kept approximate on purpose.

## Test evidence

Not applicable (docs only); cross-checked commands against `package.json` and stage names against `src/pipeline/`.

## Verdict

**Approve.** The front door now matches the system a reader will actually find behind it.
