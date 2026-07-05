# Production Readiness Plan: From Working System to Enterprise Grade

This is the deep dive behind the high-level improvement list: what "production grade" concretely requires of this system, pillar by pillar, with current state, target state, work items, and a definition of done for each. The framing question throughout is not "does it work?" — it demonstrably does — but **"what happens when it breaks, who notices, how fast, and what does it cost?"**

Maturity model used here:

```text
Idea grade        it runs on my machine and produces correct output
Production grade  it runs unattended; failures are detected, bounded, and recoverable;
                  changes are gated by evidence
Enterprise grade  other people can operate it, audit it, and bet an SLA on it
```

The system today is between idea and production: unusually strong on self-measurement (drift, latency SLO, human verdicts, audit logs) and change discipline (branch + review-doc workflow), weak on execution robustness, supply chain, and operations. This plan closes the gap in four phases.

---

## Pillar 1 — The quality loop (trust)

**Why first**: every other pillar protects the system; this one proves the system deserves protection. An early-warning product whose accuracy is unknown is a liability generator.

**Current**: labelled eval set (`npm run eval`); free per-article ground truth (`rss_recall`); drift + latency watchdogs; human review dashboard with per-dimension, append-only verdicts. The loop is **open**: verdicts accumulate but never reach the eval set; eval runs manually; thresholds (0.15/0.35 embedding bands, confidence weights) are unvalidated priors.

**Target**: human judgment compounds automatically, and no change merges if it regresses measured quality.

Work items:

1. `review:export` — transform `human_review_verdicts` (latest per article) into labelled eval cases; merge into `data/labelled-eval-set.json` with provenance (`source: human_review`, reviewer, date).
2. Eval in CI: run the labelled set on every PR; fail on regression beyond a tolerance band; publish the metrics table to the PR.
3. Threshold calibration: sweep embedding-band and confidence-rollup parameters against the labelled set; commit chosen values with the sweep evidence.
4. Expected-label capture: extend verdicts from correct/incorrect to "what it should have been" (vendor role, alert tier, grouping relation) — corrections are richer training/eval signal than verdicts.

**Done when**: a reviewed batch measurably grows the eval set; a PR that worsens grouping precision is blocked by CI, not by memory.

## Pillar 2 — Execution model (scale and resilience)

**Current**: batch sweeps over `processing_status` with per-article sequential awaits. Known holes, already documented in reviews: BullMQ jobs carry article IDs that stages ignore; no `FOR UPDATE SKIP LOCKED`, so two workers double-process; embedding failures strand articles in a status nothing polls (`EMBEDDING_PENDING`); no retry budget or dead-letter state; no bounded concurrency on network-bound stages.

**Target**: event-driven per-article flow with the sweep demoted to a backfill/self-healing lane.

Work items:

1. Stage functions accept explicit `articleId`; workers process their payload and enqueue the successor stage (`nextQueueForJob` finally used).
2. Claim queries: `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *` — horizontal workers without double-processing.
3. Retry discipline: `retry_count`/`next_retry_at` (columns exist, unused) with exponential backoff; terminal `FAILED_DEAD_LETTER` status; a sweep that reports dead-lettered articles instead of silently ignoring them.
4. Bounded concurrency (p-limit ~5–8) for extraction and embedding calls; batch embedding API requests.
5. Graceful shutdown: workers drain in-flight jobs on SIGTERM; the pool closes after, not during.
6. State machine as code: one exported enum + legal-transition map, enforced in `updateProcessingStatus` — phantom statuses (the `'EXTRACTED'` bug class) become impossible.

**Done when**: an article flows ingest→alert in seconds under push; killing a worker mid-job loses nothing; a poison article ends up dead-lettered and *visible*, not looping or stranded.

## Pillar 3 — Supply chain and build discipline

**Current**: 13 dependencies pinned to `"latest"` in package.json. This is the single most disqualifying production gap: builds are unreproducible, and any upstream publish can break deploys or inject code. The lockfile mitigates only until anyone runs a fresh install.

Work items:

1. Pin every dependency to exact versions; adopt `npm ci` everywhere.
2. Renovate/Dependabot with grouped, eval-gated upgrade PRs (Pillar 1's CI makes upgrades safe to accept).
3. `npm audit` gate in CI; SBOM generation (CycloneDX) for enterprise procurement conversations.
4. Node version pinned via `engines` + `.nvmrc`; container base image digest-pinned.

**Done when**: two clean checkouts a month apart build byte-identical dependency trees; an upgrade PR shows its eval delta before merge.

## Pillar 4 — CI/CD and environments

**Current**: check/test/eval run locally by convention; the review-doc workflow is enforced by discipline, not machinery; deploys are `tsx` on a laptop; migrations run by hand in the right order because the operator knows to.

Work items:

1. GitHub Actions: typecheck + unit tests + eval gate + audit on every PR; branch protection requiring green checks and blocking direct pushes to `main` (mechanizing the existing CLAUDE.md/AGENTS.md rule).
2. Container image (multi-stage, non-root, digest-pinned base); `docker compose` profile that runs the full stack including workers.
3. Migration discipline: forward-only with checksums, applied automatically on deploy *before* new code serves traffic; a rollback stance per migration (revert code, not schema, unless a down-script is provided).
4. Environments: dev (local test source), staging (live feeds, alerts to a sink channel), prod. Config via environment with a zod-validated schema at boot — fail fast on missing/invalid config instead of `?? ''` defaults.

**Done when**: merge to `main` produces a deployable artifact that has already passed the eval gate; a bad config refuses to boot rather than limping.

## Pillar 5 — Security

**Current**: good instincts in places (parameterized SQL throughout, zod on all LLM outputs and dashboard inputs, localhost-bound dashboard, no tool access for content-processing LLMs). Three structural gaps:

1. **Prompt injection** — the pipeline feeds adversarial web content to LLMs. Realistic attack: an attacker's article carries instructions to classify their campaign as not-relevant, suppressing alerts about themselves. Mitigations: delimit content as data in prompts; cross-check LLM verdicts against deterministic signals (not-relevant verdict + CVE/vendor hits ⇒ flag for review, never silently trust); injection test cases in the eval set — measure resistance like any other quality dimension.
2. **SSRF surface** — the fetcher follows arbitrary URLs from feeds; a malicious feed entry can point at internal addresses. Egress allowlist by registrable domain per feed; block private IP ranges; cap response sizes and redirect chains.
3. **Surfaces and secrets** — dashboard needs auth before it leaves localhost (even basic-auth-behind-TLS beats nothing); secrets move from `.env` to a managed store in deployment; API keys rotated without deploys.

**Done when**: the injection suite runs in CI with a tracked resistance score; the fetcher provably cannot reach RFC-1918 space; no secret lives in a file that could be committed.

## Pillar 6 — Observability and incident response

**Current**: structured logs (pino, with redaction), stage counters, two watchdogs that *log*. Nothing pages; no metrics endpoint; `last_processed_at` is one overwritten column, so per-stage time is unreconstructable; LLM spend is queryable from the audit log but never rolled up.

Work items:

1. Prometheus `/metrics`: stage throughput/failure counters, queue depths, per-stage latency histograms, LLM tokens+cost counters, watchdog states.
2. Stage event log (append-only `article_stage_events`): the per-stage latency breakdown the SLO watchdog can't currently provide; also the debugging timeline for "why was this alert late?".
3. Alerting on the watchdogs: drift, latency SLO breach, dead-letter accumulation, queue-depth growth → a channel a human actually watches. The system already knows when it's sick; it needs to be able to say so loudly.
4. Daily cost rollup from `llm_audit_logs` (calls, tokens, $ per stage per day) with a budget alarm.
5. Runbooks in `docs/operations/`: per alarm — meaning, dashboard, first three diagnostic steps, escalation. Enterprise means someone who didn't build it can operate it.

**Done when**: a site redesign, an SLO breach, or a cost spike interrupts a human within minutes, and the runbook they open actually helps.

## Pillar 7 — Alert delivery and lifecycle

**Current**: alerts are rows in Postgres (`alert_channel = 'database'`). No consumer-facing delivery, acknowledgment, or escalation; the two-tier model (early_warning → upgrade → material update) exists in data but nothing renders it to a human in real time.

Work items:

1. Channel abstraction with at-least-once delivery + idempotency keys; Slack/webhook first, email later. Delivery failures retry with backoff and surface in metrics.
2. Alert lifecycle: `delivered → acknowledged → resolved/false_positive`; acknowledgment data is *also quality signal* — an unacknowledged early warning that later upgrades is precision evidence; a dismissed one feeds the eval set (closing back into Pillar 1).
3. Render the tier semantics: early-warning messages visibly labeled unconfirmed with "why you're seeing this" (matched vendor, signals, confidence); upgrades edit/thread the original rather than posting a duplicate.
4. Per-channel routing rules (severity/vendor criticality → channel), suppression respecting the material-update bypass.

**Done when**: an analyst experiences the news-desk model end to end — early ping, labeled uncertainty, in-place upgrade — and their dismissals make next week's alerts better.

## Pillar 8 — Data lifecycle and continuity

**Current**: `raw_html` grows unboundedly (100–300KB per article) and is third-party copyrighted content; no retention policy, no backup verification, no DR stance; append-only tables (audit, verdicts, alerts) grow forever.

Work items:

1. Retention: drop `raw_html` after N days (fixtures cover regression needs); partition or age out audit logs; alerts and verdicts retained long-term (they're the product record and the labels).
2. Backups with *restore drills* — an untested backup is a hypothesis. Document RPO/RTO targets honestly (e.g., RPO 24h, RTO 4h is fine for this product — losing a day of articles means re-ingesting feeds).
3. Republication policy encoded: alerts carry snippets + links, never full article text.
4. Postgres single-instance is an accepted SPOF at this scale — say so in writing, with the managed-Postgres migration path named for when the acceptance expires.

**Done when**: disk usage is flat-per-month at steady state, and