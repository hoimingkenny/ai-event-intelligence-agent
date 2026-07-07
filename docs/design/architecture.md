# Architecture

## Design Principle

The LLM is not the system of record. It performs bounded, schema-validated reasoning inside a deterministic workflow. Postgres is the source of truth; every stage is a state-machine transition on `articles.processing_status`, independently retryable and auditable.

```text
Pipeline stages   = LangGraph StateGraph orchestration (or BullMQ workers)
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

The cheap filter is governed by the [Cyber Threat Keyword Classification Standard](cyber-keyword-classification-standard.md): RSS metadata is scored by operational actionability, with critical/medium/low/negative keyword categories used to decide whether an article is worth fetching and extracting.

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

## Human Quality Control

The human review dashboard is the analyst-facing observability layer for AI and pipeline decisions. It exists to monitor results, catch wrong tags, and capture structured corrections across the article lifecycle: filtering, extraction, entity detection, LLM classification, event grouping, and alerting.

Human verdicts do not directly mutate prompts, thresholds, or model behavior. They are stored as auditable review data and should feed the evaluation loop first. Improvements happen only after reviewed cases reveal a measurable failure pattern and a deliberate engineering change proves better against the evaluation set.

## Work Ordering

Stage queues process newest-published first — breaking news must not queue behind backlog. Original-detection queries (`findEarlierByContentHash`, `findRecentByTitleHash`) intentionally keep oldest-first semantics.

## Orchestration

The runner is a LangGraph StateGraph: one node per stage plus watchdog nodes (drift after extraction, latency after alerts), linear edges, and a single conditional edge that skips LLM classification when no API key is configured. The graph owns sequencing only — Postgres (`articles.processing_status`) remains the system of record, so a crashed run resumes by running the graph again. The planned analyst copilot will be a LangGraph agent whose tools are read-only queries over this same state.

## Legacy

`src/graph.ts`, `src/nodes/`, `src/agents/`, `src/storage/` are the superseded in-memory/Qdrant scaffold, kept for reference only.
