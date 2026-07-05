# Production Readiness Roadmap

From working prototype to enterprise-grade. This is a *plan* — a snapshot of intent, not current state. It defines what "production-grade" means for this specific system, why each gap matters, and the order to close them.

The organizing principle: **an enterprise buyer's due-diligence questions are the specification.** A security-tooling procurement team asks, in roughly this order: Does it work correctly, and can you prove it? What happens when it breaks? Can you operate it? Is it secure? Can we trust the data handling? Each maturity level below answers one of those questions.

---

## Where the project is today

Already present (uncommon for a prototype, worth stating so the gaps are seen in context):

- Deterministic pipeline with a per-stage state machine; LLM bounded and audit-logged.
- Self-evaluation in production: extraction recall ground truth, drift detection, latency SLO watchdog.
- Human-in-the-loop review with append-only per-dimension verdicts.
- ~113 tests with pure decision logic isolated from I/O; enforced review-before-merge workflow.
- LangGraph orchestration; deterministic core kept as the system of record.

What follows is what a paying enterprise customer would still block on.

---

## Level 1 — Correctness you can prove (release-blocking)

The claim "it works" must be a number that regresses visibly, not an assertion.

**1.1 Close the evaluation loop.** Human verdicts accumulate in Postgres but do not yet feed `data/labelled-eval-set.json`. Build `review:export` to convert reviewed verdicts into labelled eval items, so every review session permanently hardens the regression set. Without this, human effort evaporates and the eval set stays static.

**1.2 Eval-in-CI as a merge gate.** Run the labelled eval on every PR; fail the build if dedup precision, grouping precision, classification precision, or extraction recall drop below committed thresholds. This is what turns "we have tests" into "we cannot ship a regression." Prompt and threshold changes get the same gate as code.

**1.3 Golden end-to-end fixtures.** The deterministic local test source exists; extend it into a committed golden-path suite that runs the full StateGraph and asserts final event/alert shape, so orchestration changes are covered, not just unit logic.

**Exit criterion:** a red CI check blocks any merge that regresses a quality metric, and the eval set grows from real reviews.

---

## Level 2 — Behaviour under failure (reliability)

Enterprises buy the failure modes, not the happy path.

**2.1 Event-driven execution.** Replace batch sweeps with per-article push-through: each stage enqueues the next (`nextQueueForJob` already exists), workers claim work with `FOR UPDATE SKIP LOCKED`, and jobs carry IDs instead of re-scanning by status. This collapses latency from "sum of sweep intervals" to seconds and makes horizontal scaling safe.

**2.2 Retry, backoff, dead-letter.** Every stage needs a retry counter, exponential backoff, and a terminal dead-letter state that surfaces in the review dashboard. Today a failed embedding can strand an article in a status no stage reads — silent data loss. Failures must be visible and recoverable, never silent.

**2.3 Idempotency and exactly-once effects.** Re-running a stage after a crash must not double-write events, double-attach articles, or double-send alerts. Audit the mutating paths; the `alerts` and `event_articles` writes are the highest risk.

**2.4 Graceful degradation per dependency.** Define explicit behaviour for: LLM provider outage (queue and drain — mostly true today, make it deliberate and tested), embedding API down, Postgres failover, Redis loss. Each should degrade a capability, not corrupt state.

**Exit criterion:** kill any worker or dependency mid-run; the system resumes with no duplicate side effects and no stranded records.

---

## Level 3 — Operability (can someone else run it?)

If only the author can operate it, it is not production software.

**3.1 Metrics endpoint.** Prometheus-style `/metrics`: per-stage throughput and latency, queue depths, LLM cost per stage (from the audit log), drift and SLO status as gauges. Today the watchdogs log; production pages.

**3.2 Structured tracing.** Propagate a correlation ID from article ingest through to alert so one incident's full journey is queryable. Add per-stage timestamps (the latency metric is currently end-to-end only — you cannot yet see *where* time goes).

**3.3 Alerting on the watchdogs.** Drift and SLO breaches should route to a human channel (PagerDuty/Slack), not sit in logs. The system already knows when it is unhealthy; production means it says so.

**3.4 Runbooks + dashboards.** A Grafana board for the golden signals and a runbook per failure mode ("drift alarm fired → here is the triage path"). This is the artifact that lets an on-call engineer who didn't build it respond at 3am.

**Exit criterion:** an engineer who has never seen the code can detect, triage, and recover from a production incident using only the dashboards and runbooks.

---

## Level 4 — Security & trust (procurement will audit this)

**4.1 Prompt-injection hardening.** The pipeline feeds untrusted web content to LLMs; the realistic attack is an adversary suppressing classification of their own campaign. Defences: content-processing LLMs keep zero tool access (true today — make it an enforced invariant), outputs stay schema-constrained, and LLM verdicts are cross-checked against deterministic signals (a "not relevant" verdict on an article with a CVE + vendor match is flagged, not trusted). This deserves its own engineering note.

**4.2 Secrets management.** Move beyond `.env` to a secrets manager (Vault / cloud KMS); no credentials in images or logs; rotation policy.

**4.3 AuthN/AuthZ.** The review dashboard binds to localhost with no auth. Any networked surface needs authentication, and the analyst copilot (when built) needs per-tool authorization with mutations gated behind human confirmation.

**4.4 Supply-chain integrity.** `package.json` pins 13 dependencies to `"latest"` — a release-blocking reproducibility and security hole. Pin exact versions, commit the lockfile as the source of truth, add automated dependency-vulnerability scanning (Dependabot/Renovate + `npm audit` in CI) and SBOM generation.

**Exit criterion:** passes a standard vendor security questionnaire; builds are byte-reproducible; no plaintext secrets anywhere.

---

## Level 5 — Data lifecycle & compliance

**5.1 Retention policy.** `raw_html` is bulky and copyrighted; define retention (e.g. purge raw HTML after extraction succeeds, keep clean_text + hash), audit-log rotation, and event archival. Unbounded growth is an eventual outage.

**5.2 Republication boundaries.** Alerts must ship snippets + source links, never full article text — a copyright and licensing constraint, enforced in code, not convention.

**5.3 Backup / restore / migration rollback.** A tested restore drill (not just backups existing) and a rollback strategy for every migration. Migrations are currently forward-only.

**Exit criterion:** a documented, tested answer to "restore to yesterday 3pm" and "roll back the last schema change."

---

## Level 6 — Delivery & product surface

**6.1 Real notification channels.** Alerts currently land in a database table. Production means Slack/webhook/email/ticketing with delivery retries, acknowledgment tracking, and per-channel dedup so the same event does not spam five ways.

**6.2 Model & prompt lifecycle.** Pinned model versions, a provider-fallback path behind the existing client abstraction, and eval-gated upgrades (run the new model/prompt against the labelled set before switching).

**6.3 Source hierarchy & speed.** Tier-0/1 sources (Mastodon/PSIRT/CISA KEV) with `trust_level` wired into confidence, grouping-key aliases, adaptive per-feed polling with conditional GET. This is where the mission's speed advantage actually lives.

---

## CI/CD & delivery (spans all levels)

The mechanism that makes the above enforceable rather than aspirational:

- GitHub Actions: `check` + `test` + `eval` on every PR; branch protection enforcing the review-doc workflow mechanically.
- Containerized build with a migration-ordering guarantee (migrate before app start, fail closed on migration error).
- Staged rollout with a health gate and automated rollback on SLO breach.

---

## Suggested sequence and rationale

1. **Level 1** first — without provable correctness, everything above optimizes an unknown quantity. It is also the smallest diff (export + CI wiring on top of an existing eval).
2. **Dependency pinning (4.4)** immediately alongside — it is a one-session fix and a release-blocking red flag reviewers spot instantly.
3. **Level 2** next — reliability is what separates "demo" from "system", and the event-driven rework (2.1) also unlocks the latency mission.
4. **Level 3** once it is scaling — operability matters when someone other than the author runs it.
5. **Levels 4–6** as the customer profile demands; 4.1 (prompt injection) is the one security item worth doing early because it is domain-specific and interview-distinctive.

## How to read this document

Each level is a promotion gate: do not claim the next maturity level until the prior exit criterion is met and demonstrable. "Enterprise-grade" is not a feature list — it is the ability to answer every due-diligence question above with evidence, not intent.
