# Code Review: Scheduled deployment (every-20-min pipeline)

- **Branch:** `feat/scheduled-deployment` → `main`
- **Date:** 2026-07-05
- **Reviewer:** Claude

## Summary of change

Makes the one-shot batch pipeline deployable on a fixed cadence. `runScheduledPipeline` (shared core) wraps `runPipeline` in a Postgres advisory lock so overlapping runs are skipped, not stacked, and multiple replicas are safe. Two entrypoints share it: an internal self-rescheduling loop (`scripts/run-scheduler.ts`, `npm run scheduler`) and the one-shot (`scripts/run-pipeline.ts`, for external cron/CronJob). Adds a multi-stage non-root `Dockerfile` and compose services (`migrate` → `scheduler`/`dashboard`) with migrate-before-traffic ordering. Rationale: `docs/engineering-notes/deployment-and-scheduling.md`.

## Behaviour changes

- New `npm run scheduler` (internal loop, default cadence `RSS_FETCH_INTERVAL_MINUTES`, previously read by nothing — now the knob).
- `npm run pipeline:run` now advisory-locks: a run that fires while another is in progress prints `{ran:false, reason:"locked"}` and exits 0. Same flags (`--limit`, `--skip-ingest`, `--include-llm`).
- `docker compose up` now builds and runs the app: migrations, scheduler, and an optional localhost-bound dashboard (previously compose was Postgres+Redis only).
- No schema change; the lock is a session advisory lock, not a table.

## Risks and concerns

- **Advisory lock key is a fixed constant** — fine for one logical pipeline; document it if a second locked job is added (collisions would serialize unrelated work).
- **Dockerfile uses tag, not digest** — noted inline; Pillar 3 (dependency pinning) will digest-pin the base image. Also `"latest"`-pinned npm deps still make `npm ci` non-reproducible until pinned — pre-existing, tracked.
- **Internal-loop `setTimeout` drift** is intentional (measures from run end, not wall clock) so cadence is "≥ interval between runs", not "exactly on the 20". For an early-warning batch that is correct; a wall-clock cron is the external-scheduler path if exact ticks are wanted.
- **Latency**: up to ~20 min before a fresh article is picked up — inside the 2h SLO, and the event-driven model (Pillar 2) remains the low-latency future. Stated in the note.

## Test evidence

- `npm run check` clean; `vitest` 130 passed / 4 skipped (3 pre-existing MiniMax network failures only).
- 4 new tests: lock acquired → runs, unlocks, releases; lock held → skips without running; pipeline throws → lock still released; default key path. runPipeline mocked, so no DB needed.

## Follow-ups

Kubernetes CronJob manifest for the external pattern; zod-validated config-at-boot (fail fast on bad env); wall-clock scheduling option if exact cadence is ever required.

## Verdict

**Approve.** Deployable cadence with the one real hazard (overlapping runs) closed by an infra-free, crash-safe, replica-safe lock, and both trigger patterns sharing one tested core.
