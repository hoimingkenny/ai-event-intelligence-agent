# Project Pitch

## 30 seconds

"I built a cyber early-warning agent that monitors security feeds, deduplicates coverage of the same incident across sources into canonical events, maps them to a monitored vendor inventory, and alerts within a 2-hour triage window. The design principle is that the LLM is never the system of record — it does specialist reasoning inside a deterministic, auditable pipeline. Over 90% of decisions are resolved by deterministic tiers for free; the LLM only sees the genuinely ambiguous cases."

## 2 minutes (architecture walkthrough)

1. **Ingestion → cheap filter**: RSS from curated sources; regex/keyword/CVE/vendor-inventory matching drops irrelevant items before any expensive work. Cost ordering is deliberate: cheapest checks first.
2. **Extraction**: layered cleaner — per-source CSS selectors for known sites, DOM pruning + Readability for unknown ones, structure-based native-ad removal (repeated offsite campaign links, deliberately not class names). Every extraction self-scores against a free ground truth: word recall of the RSS summary vs extracted text.
3. **Dedup + event grouping ladder**: content hash → title hash → embedding similarity (pgvector) → LLM comparator *only* in the uncertain distance band (0.15–0.35 cosine). Same ladder philosophy everywhere: deterministic where possible, LLM where necessary.
4. **Classification feedback**: LLM classification rolls up into event severity/confidence with never-downgrade semantics and a per-source corroboration bonus; the alert gate operates on that computed confidence.
5. **Two-tier alerting (news-desk model)**: fresh vendor-matched events alert *immediately* as `early_warning`, explicitly labeled unconfirmed; the strict gate (severity/urgency/confidence) applies to the `confirmed` tier, and early alerts are *upgraded* when they cross it. Material updates always bypass the suppression window. Work queues process newest-published first — breaking news never queues behind backlog.
6. **Self-monitoring**: per-source rolling median of extraction recall = drift detection (site redesign surfaces same-day), plus a publication→alert latency SLO watchdog (p90 vs the 2h window) — the product metric is itself monitored.
7. **Human-in-the-loop quality**: a review dashboard captures per-dimension verdicts (relevance / vendor impact / classification / grouping / alert) into Postgres, append-only so re-reviews measure improvement; the queue is attention-first — review time goes where the pipeline is least sure.
8. **Auditability**: every LLM call logged with prompt version, request, response, validation status. Postgres is the source of truth; the LangGraph StateGraph owns sequencing only — every stage is a state machine transition, independently retryable.

## Numbers to know cold

- Dedup/grouping tiers: hash → title (7-day window) → embedding attach ≤ 0.15 distance → LLM band 0.15–0.35 → new event
- Extraction fixture regression thresholds: recall ≥ 0.8, precision ≥ 0.6 vs human reference
- Drift thresholds: rolling window 20 articles/source, min 5 samples, median recall < 0.6 flags
- Confidence rollup: 0.35 + 0.4 × LLM confidence + 0.1/extra source (cap 3), ceiling 0.95; not-cyber-relevant caps at 0.2
- Alerting: early-warning window 24h (unknown age = fresh, fail toward labeled signal); confirmed gate severity ≥ medium + P1/P2 + confidence ≥ 0.75; latency SLO p90 ≤ 2h publication→alert
- Test suite: ~113 tests; all decision logic (grouping ladder, alert policy, rollup) is pure functions tested without a database
- Stack: TypeScript, LangGraph (StateGraph runner; copilot planned), Postgres + pgvector (HNSW), Redis/BullMQ, MiniMax LLM + embeddings, Readability/linkedom, vitest

## One-line differentiators

- "How do you know your agent works?" → labelled eval set + free per-article ground truth + drift detection.
- "The pipeline detects when a website redesign breaks it — extraction quality is a monitored metric, not an assumption."
- "LLM cost is bounded by design: it only sees the uncertain band."
- "It alerts like a news desk: labeled early signal now, upgrade to confirmed later — never silence in between."
- "Human verdicts are append-only per decision dimension, so re-reviews after a fix become measurable evidence of improvement."
