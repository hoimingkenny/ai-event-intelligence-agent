# Trade-offs

## PostgreSQL + pgvector Instead of a Dedicated Vector Database

PostgreSQL is the source of truth because the workflow is state-heavy and audit-heavy. It needs article metadata, processing status, entities, event lineage, LLM audit records, and alerts in one transactionally reliable place.

pgvector keeps semantic retrieval close to that relational state. A dedicated vector database can be added later if vector search scale becomes the bottleneck.

## HTTP + Readability Only; Playwright Disabled

HTTP extraction with layered Readability cleaning is the only active path. The Playwright fallback is currently disabled (still injectable for tests) while extraction quality work focuses on the static path — the curated feeds are all server-rendered. JS-only sources will fail extraction until it is re-enabled.

## Structure-Based Ad Removal Over Class-Name Blacklists

Native ads are detected by what they must do (repeat an offsite campaign link across a small image/headline/CTA cluster), not by what they happen to look like (class names a redesign invalidates). The cost is guardrail complexity — span/char limits, same-site exemption — each covered by a dedicated false-removal test.

## Two-Tier Alerting: Accept Noise to Never Miss Early Signals

A fresh vendor-matched event alerts immediately as `early_warning`, labeled unconfirmed, even at low confidence — the strict gate applies only to the `confirmed` tier and upgrades. The accepted cost is alert volume; the rejected cost was silently suppressing exactly the signals a 2-hour impact window exists for. Unknown event age counts as fresh (fail toward labeled signal, not silence).

## Newest-First Work Ordering

Stage queues process the most recently published articles first. Under sustained backlog old articles can wait — deliberately: for early warning, stale news is the correct thing to sacrifice, and sweeps still drain everything eventually.

## Fail-Open Comparator

When the LLM event comparator errors, the article becomes a new event rather than merging into the candidate. Asymmetric recoverability: spurious splits can be merged later; silently fused incidents are data loss.

## Measurement Before Automation

Extraction quality metrics and drift detection were built before any self-healing (LLM re-learning of extraction rules). Without a metric, a newly learned rule cannot be validated; with one, re-learning can be event-triggered and verified instead of scheduled and hoped-for.

## Agent Framework as Client, Never Owner

LangGraph orchestrates the pipeline graph and will power the analyst copilot, but pipeline stages stay plain functions and Postgres stays the system of record. The framework owns sequencing and (for the copilot) the conversation/tool loop; it is a client of the pipeline's state, never its owner. Full decision record: `docs/engineering-notes/agent-framework-decision.md`.

## Single-Purpose LLM Calls Before Multi-Agent

Every LLM call has one bounded job with a zod schema and audit row. Multi-agent structure is reserved for places where roles genuinely differ (enrichment fan-out, proposer/validator separation in self-healing, generator–critic on alerts) — never for restructuring the same output with more calls.

## Event-Level Embeddings

Article-only comparison grows expensive as volume increases. Event embeddings let the system compare new articles against compact event representations before falling back to article-to-article comparisons.

## LLM as Bounded Reasoning

The LLM is not the workflow. Deterministic filters, hashes, entities, and pgvector retrieval narrow the decision space first. LLM calls are reserved for classification, ambiguous comparison, and concise event summaries.

## Modular Monolith Before Microservices

The initial system is a modular TypeScript backend with BullMQ workers. This avoids premature distributed-system overhead while preserving clear boundaries for future extraction into services.

## Alerts Instead of Generic Notifications

The portfolio plan is domain-agnostic, but this repo is cyber-focused. The implementation uses `alerts` because users reviewing vendor-risk events expect alert terminology. Generic notification channels can still be layered on later.
