# Trade-offs

## PostgreSQL + pgvector Instead of a Dedicated Vector Database

PostgreSQL is the source of truth because the workflow is state-heavy and audit-heavy. It needs article metadata, processing status, entities, event lineage, LLM audit records, and alerts in one transactionally reliable place.

pgvector keeps semantic retrieval close to that relational state. A dedicated vector database can be added later if vector search scale becomes the bottleneck.

## HTTP Extraction Before Playwright

HTTP extraction is cheaper and faster than browser automation. Playwright is available as a fallback for JavaScript-rendered or extraction-resistant pages, but it is intentionally not the default path.

## Event-Level Embeddings

Article-only comparison grows expensive as volume increases. Event embeddings let the system compare new articles against compact event representations before falling back to article-to-article comparisons.

## LLM as Bounded Reasoning

The LLM is not the workflow. Deterministic filters, hashes, entities, and pgvector retrieval narrow the decision space first. LLM calls are reserved for classification, ambiguous comparison, and concise event summaries.

## Modular Monolith Before Microservices

The initial system is a modular TypeScript backend with BullMQ workers. This avoids premature distributed-system overhead while preserving clear boundaries for future extraction into services.

## Alerts Instead of Generic Notifications

The portfolio plan is domain-agnostic, but this repo is cyber-focused. The implementation uses `alerts` because users reviewing vendor-risk events expect alert terminology. Generic notification channels can still be layered on later.
