# Deployment and Scheduling: Running the Pipeline Every 20 Minutes

How the batch pipeline is deployed and kept running on a fixed cadence, and — the part that actually matters — how overlapping runs are prevented without new infrastructure. Records the design decisions behind `scheduled-run.ts`, `scheduler.ts`, the `Dockerfile`, and the compose services.

## 1. The problem

The pipeline is a one-shot batch job: it runs all stages once and exits. To operate it, something must trigger it every 20 minutes, unattended, safely across restarts. The naive answer ("wrap it in `setInterval`") has a latent hazard that only shows up under load, so the design is built around that hazard.

## 2. Trigger: where the clock lives

Three patterns, differing only in *where the schedule lives*:

- **External scheduler → one-shot container** (system cron, Kubernetes CronJob, cloud scheduler): a fresh container runs the pipeline and exits. Best restart-safety, no long-lived process; the production-standard shape.
- **Internal scheduler**: a long-running container loops on a timer. One service, zero external dependencies — simplest to run and demo.
- **BullMQ repeatable job**: the natural home *once the system moves to event-driven per-article processing* (Pillar 2), overkill for triggering a batch sweep today.

Decision: **support both** external and internal, sharing one advisory-locked core (`runScheduledPipeline`). The internal loop (`scripts/run-scheduler.ts`, the compose default) is the zero-dependency path; the one-shot (`scripts/run-pipeline.ts`) is what an external cron/CronJob invokes. Same safety guarantees either way, because the guarantee lives in the shared core, not the trigger.

## 3. The hazard everyone forgets: overlapping runs

A 20-minute schedule assumes a run finishes in under 20 minutes. Under backlog, a slow LLM, or a stuck fetch, it might not — and then tick N+1 starts a second run over the same `processing_status` rows while N is still going. Two runs racing on the same data is duplicate work at best, double side effects at worst.

The fix is a **Postgres session-level advisory lock** (`pg_try_advisory_lock`), chosen because:

- **Zero new infrastructure** — Postgres is already the system of record.
- **Non-blocking** — `pg_try_advisory_lock` returns `false` immediately if held, so an overrunning run causes the next tick to be *skipped and logged* (`scheduled_pipeline_skipped_locked`), never stacked.
- **Crash-safe** — the lock is tied to the connection; if the process dies mid-run, the lock releases automatically. No stale lock to clean up.
- **Replica-safe** — run three copies of the scheduler for availability and only the lock holder executes; the rest skip. The pipeline becomes a singleton job regardless of how many schedulers fire it.

This is safe precisely because the pipeline is already idempotent: Postgres state drives what each stage picks up, so a skipped tick or a resumed-after-crash run loses nothing (the same property that made the one-shot design valid in the first place).

The internal loop adds a second, softer guard: it uses self-rescheduling `setTimeout` measured from the *end* of each run (not `setInterval`), so an overrunning run delays the next tick rather than firing one on top of it. The advisory lock remains the hard guarantee, especially across replicas.

## 4. Graceful shutdown

SIGTERM during a run must not corrupt state. The scheduler's `stop()` clears the timer and *awaits the in-flight run* before resolving; compose gives it a 60s `stop_grace_period`. A run either completes or (if killed past the grace period) leaves Postgres in a consistent mid-pipeline state that the next run resumes — never a half-written event.

## 5. Deployment shape (compose)

```text
postgres  (pgvector)   ── healthchecked
migrate                 ── runs db:migrate, exits 0; app waits on it
scheduler               ── internal loop, every RSS_FETCH_INTERVAL_MINUTES
web                     ── Next.js public + /workspace (127.0.0.1:3000)
redis / portal / dashboard ── optional Compose profiles (queue / legacy)
```

Phase-1 production profile is postgres + migrate + scheduler + web. See
[phase1-vps-cloudflare.md](./phase1-vps-cloudflare.md) for VPS + TLS/domain.

Two ordering guarantees enforced by compose:

- **Migrate before traffic**: `scheduler`/`web` `depends_on` migrate with `condition: service_completed_successfully`. Code never serves against a half-migrated schema, and a failed migration aborts the deploy (fails closed) rather than starting a broken app.
- **DB healthy before migrate**: migrate waits on the Postgres healthcheck.

The pipeline `Dockerfile` is multi-stage, installs with `npm ci` for reproducibility, and runs as the non-root `node` user. The default `CMD` is the scheduler; override to `pipeline:run` (external cron) or `worker` (queue mode) per environment. The Next.js app uses `Dockerfile.web` (standalone output).

## 6. Latency note — why 20 minutes is fine now, and not forever

A 20-minute batch means up to ~20 minutes of scheduling latency before a fresh article is even picked up. That is comfortably inside the 2-hour impact-review window, so batch scheduling is the correct pragmatic deploy today. It is *not* the end state: the event-driven per-article push model (Pillar 2) is the path to seconds-not-minutes when the mission demands it. Batch-every-20-min is the floor; per-article push is the ceiling. Stating the number keeps the trade-off honest.

## File index

| File | Role |
|---|---|
| `src/pipeline/scheduled-run.ts` | Advisory-locked singleton run (shared core) |
| `src/pipeline/scheduler.ts` | Internal self-rescheduling loop + graceful stop |
| `scripts/run-scheduler.ts` | Internal scheduler entrypoint (SIGTERM/SIGINT) |
| `scripts/run-pipeline.ts` | One-shot entrypoint for external cron/CronJob |
| `Dockerfile` | Multi-stage pipeline image, non-root |
| `Dockerfile.web` | Next.js standalone image (public + workspace) |
| `docker-compose.yml` | migrate → scheduler/web (+ optional profiles) |
| `tests/scheduled-run.test.ts` | Lock acquire/skip/error-release behaviour |
| `docs/engineering-notes/phase1-vps-cloudflare.md` | VPS + Cloudflare TLS/domain runbook |
