# Design Decisions and Justifications

Each entry: the decision, the justification, and the trade-off you accepted. Interviewers probe the third part — always know what you gave up.

## LLM is not the system of record

**Decision**: Postgres is the source of truth; LLMs do bounded reasoning tasks (classify, compare, summarize) whose outputs are schema-validated before persistence.
**Why**: reproducibility, auditability, retryability. You can re-run any stage; you can answer "why did the system do X" from the audit log.
**Trade-off**: less "magical" than an end-to-end agent; more plumbing code.

## Ladder architecture (cheap → expensive) for dedup and grouping

**Decision**: hash → key match → embedding bands → LLM only in the uncertain band.
**Why**: cost and latency are bounded by design, not by hoping the LLM is cheap. Deterministic tiers are also *testable* — the pure decision function has full unit coverage with no mocking.
**Trade-off**: threshold tuning (0.15/0.35) is a prior until validated against the labelled set; two thresholds are extra config surface.

## Fail-open on comparator error (create new event, don't merge)

**Decision**: if the LLM comparator fails, create a separate event rather than guessing a merge.
**Why**: asymmetric recoverability — a spurious split can be merged later; two incidents silently fused is data loss in a security tool.
**Generalization**: decide fail-open vs fail-closed per decision based on which error is recoverable, not one policy for the whole system.

## Structure-based ad removal, not class-name blacklists

**Decision**: detect native ads via repeated offsite campaign links (image + headline + CTA sharing one normalized URL), not `class="ad"` matching.
**Why**: class names are surface features sites change at will; "an ad must repeat its campaign link to drive traffic" is a structural property of its business function. Same logic as TTPs-over-IOCs in threat detection.
**Trade-off**: needs false-positive guardrails (span/char limits, same-site exemption) — each guardrail has a dedicated test.

## RSS summary as free ground truth

**Decision**: score every extraction by word recall of the RSS summary against extracted text.
**Why**: the summary is drawn from the article body, so recall ~1.0 when extraction is healthy and collapses when it breaks — a per-article quality label with zero human effort and zero LLM cost.
**Subtlety that impresses**: it's `null` for rss-only extractions, because the summary's recall against itself is trivially 1 — the metric must be protected from being gamed by its own pipeline.

## Drift detection with rolling medians, not means

**Decision**: per-source rolling median (window 20, min 5 samples) with thresholds.
**Why**: medians are outlier-immune — one weird short article doesn't page anyone; only systematic degradation moves the median. Min-sample floor prevents low-volume feeds from crying wolf.

## Measurement before automation (why not "LLM re-learns rules daily")

**Decision**: build quality metrics + drift detection first; rule re-learning is event-triggered and validated, not scheduled.
**Why**: without a metric, you can't tell whether a newly learned rule is good; scheduled re-learning burns tokens on sites that haven't changed. Order: make degradation observable → make repair verifiable → then automate repair.

## Multi-agent as a conscious non-decision (so far)

**Decision**: single-purpose LLM calls inside a deterministic workflow; no agent crew.
**Why**: agents should differ by role/tools/stance, and every crew needs a deterministic referee. Where it *would* be justified here: enrichment fan-out (CVE/advisory/exploit-intel collectors + synthesizer), proposer/validator separation in self-healing extraction (an agent must not grade its own homework), and a generator–critic pair on alerts.
**Cost answer**: enrichment would run per-event post-dedup (~10-20/day), cached by CVE, hard token budgets — pennies per day. Multi-agent costs more because it does more *work*, not because of the pattern; the wasteful version is agents restructuring the same output.

## Two-tier alerting: accept noise, never suppress early signals

**Decision**: `early_warning` tier alerts on any fresh vendor-matched event, labeled unconfirmed; the strict gate applies only to `confirmed`, which upgrades earlier warnings. Unknown event age counts as fresh.
**Why**: the original single gate (confidence ≥ 0.75) structurally suppressed exactly the low-confidence fresh signals a 2-hour window exists for — the system's own guardrail said "label early signals", the code silently dropped them. Traders don't wait for confirmation; they act on the signal and size by confidence.
**Trade-off**: alert volume rises by design; the tier label is the consumer's filter, and `EARLY_WARNING_WINDOW_HOURS` is the noise dial.

## Newest-first work ordering

**Decision**: stage queues process most-recently-published first (previously FIFO by fetch time).
**Why**: breaking news must not queue behind backlog — for early warning, stale news is the correct thing to sacrifice under load.
**Trade-off**: theoretical starvation of old articles under sustained backlog; accepted, sweeps drain eventually. Note the deliberate exception: original-detection queries (content/title hash) keep oldest-first because they *find the original*.

## Agent framework as client, never owner

**Decision**: LangGraph runs the pipeline StateGraph and will power the analyst copilot; pipeline stages stay plain functions; Postgres stays the system of record. `@openai/agents` leaves with the legacy scaffold.
**Why**: the graph owns sequencing only (crash recovery is still "run it again"); the framework earns its keep where there's a genuine loop — the copilot's multi-turn tool use and interrupt-based human confirmation. Wrapping bounded single LLM calls in agent abstractions is résumé-driven engineering.
**Gotcha worth telling**: LangGraph forbids node names colliding with state channel names — hence `_stage` suffixes.

## Human review: append-only verdicts, attention-first queue

**Decision**: per-dimension human verdicts (relevance / vendor impact / classification / grouping / alert) stored append-only; the review queue sorts needs-attention cases first (uncertain relationships, low-confidence events, unsuppressed early warnings).
**Why**: per-dimension tells you *which stage* is weak, not just "the pipeline was wrong". Append-only means re-reviews after a fix become before/after evidence of improvement — an upsert would have destroyed exactly that signal. Attention-first because human labels are the scarcest resource in the system; spend them where the model is least sure.
**Open loop (name it honestly)**: verdicts don't yet export into the eval set — that's the next step, and knowing it's the next step is the point.

## Never-downgrade severity semantics

**Decision**: event severity/urgency only ratchet upward across articles; confidence never drops below an established value.
**Why**: for a triage system, failing alarming beats failing silent; a milder follow-up article shouldn't soften an event a critical report established.
**Trade-off**: a bad early classification pins severity high until human review — accepted and stated.

## Process: review-before-merge, plans vs notes vs reviews

**Decision**: no direct commits to main; every merge ships a code review doc (behaviour changes, risks, test evidence, verdict); docs split into plans / design / engineering-notes / code-reviews by intent.
**Why**: solo project discipline that mirrors team practice; the review docs double as an audit trail of judgment calls.
