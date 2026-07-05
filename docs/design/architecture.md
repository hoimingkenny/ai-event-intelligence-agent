# Architecture

## Design Principle

The LLM is not the system of record. It performs bounded, schema-validated reasoning inside a deterministic workflow. Postgres is the source of truth; every stage is a state-machine transition on `articles.processing_status`, independently retryable and auditable.

```text
Pipeline stages   = deterministic orchestration (sequential runner or BullMQ workers)
LLM (MiniMax)     = bounded reasoning: classify, compare, summarize — zod-validated
Postgres+pgvector = source of truth + semantic retrieval
Monitoring        = the system watches its own quality (drift) and speed (latency SLO)
```

## Pipeline

```text
ingest (RSS) → cheap filter → extraction → entities → article embeddings
  → dedup → event grouping → event embeddings → LLM classification → alerts
```

Cost ordering is a design rule: the cheapest possible check runs first at every step, and the LLM only sees what deterministic tiers could not resolve.

## The Ladder Pattern

Both dedup and event grouping use the same shape — deterministic where possible, LLM where necessary:

```text
Article dedup:   content hash → title hash (7d window) → embedding similarity
Event grouping:  grouping_key exact match → event-embedding distance
                   (attach ≤ 0.15 / uncertain ≤ 0.35 / new event beyond)
                   → LLM comparator for the uncertain band only
```

Grouping decisions are pure functions (`src/events/grouping-decision.ts`), separated from I/O so the entire ladder is unit-testable without a database. Comparator failure fails open to a new event: a spurious split is mergeable later; silently fusing two incidents is not.

Deduplication result types:

```text
same_article_duplicate → same_event_no_new_information → same_event_new_source
→ same_event_material_update → related_but_separate_event → separate_event
→ uncertain_need_human_review
```

## Extraction

Layered cleaning (`src/extraction/readable-content.ts`): per-source CSS selectors for curated feeds → DOM pruning + Readability for unknown domains → boilerplate line filtering. Native-ad removal is structure-based (repeated offsite campaign links), deliberately not class-name-based, with false-removal guardrails. Every extraction self-scores: `rss_recall` = word recall of the RSS summary against extracted text — free per-article ground truth.

## Two-Tier Alerting (the operating modes, realized)

```text
early_warning: fresh event (≤ EARLY_WARNING_WINDOW_HOURS) touching a monitored
               vendor alerts immediately, explicitly labeled unconfirmed.
confirmed:     strict gate (severity ≥ medium, P1/P2, confidence ≥ threshold).
               An early warning is UPGRADED when it crosses this gate.
```

Material updates always bypass the recent-alert suppression window. Unknown event age counts as fresh — the policy fails toward a labeled signal, never toward silence. Event confidence is computed, not hardcoded: LLM classification rolls up with never-downgrade severity semantics and a per-source corroboration bonus.

## Self-Monitoring

```text
Extraction drift: rolling median rss_recall per source (window 20, min 5 samples)
                  → a site redesign surfaces the same day.        npm run drift:check
Alert latency:    publication → alert p50/p90 vs the 2h SLO.      npm run latency:check
```

Both run inside every pipeline sweep and as standalone watchdogs (exit 2 on breach, cron-able). Every LLM call is recorded in `llm_audit_logs` with prompt version, payloads, and validation status.

## Work Ordering

Stage queues process newest-published first — breaking news must not queue behind backlog. Original-detection queries (`findEarlierByContentHash`, `findRecentByTitleHash`) intentionally keep oldest-first semantics.

## Legacy

`src/graph.ts`, `src/nodes/`, `src/agents/`, `src/storage/` are the superseded in-memory/Qdrant scaffold, kept for reference only. Conversion of the runner to a LangGraph StateGraph is planned, not current.
