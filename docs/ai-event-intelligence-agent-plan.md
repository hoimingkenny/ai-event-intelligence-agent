AI Event Intelligence Agent

1. Project Overview

AI Event Intelligence Agent is a backend AI workflow system that transforms noisy RSS and web content into structured, deduplicated, event-level intelligence records.

Unlike simple LLM summarisation tools, this project separates source articles from real-world events. It uses deterministic matching, semantic retrieval, event-level embeddings, structured LLM reasoning, and evaluation metrics to group related articles, suppress duplicate notifications, and generate traceable event intelligence.

The system is designed as a staged agent workflow with controlled tool usage, including RSS ingestion, web extraction, entity detection, semantic retrieval, event comparison, summarisation, and notification decisioning. Each stage is independently retryable, auditable, and measurable.

The architecture is domain-agnostic and can be adapted to:

* financial news monitoring
* regulatory intelligence
* market intelligence
* product update tracking
* policy monitoring
* enterprise knowledge workflows
* vendor or technology news monitoring

The main goal is to demonstrate how an AI agent can be designed as a reliable backend workflow system rather than a simple chatbot or one-off LLM wrapper.

⸻

2. Core Problem

Most AI news monitoring systems are too simple:

RSS feed → LLM summary → save result

This approach has several problems:

* It treats every article as a separate event.
* It creates duplicate outputs when multiple sources report the same story.
* It sends too much content to the LLM.
* It lacks auditability.
* It does not distinguish between repeated articles and materially new updates.
* It has no measurable quality evaluation.
* It becomes noisy when used for monitoring high-volume news sources.

This project solves the problem by using a more robust architecture:

RSS/Web → Extraction → Entity Detection → Embedding → Semantic Retrieval → Deduplication → Event Grouping → Structured LLM Reasoning → Review/Notification → Evaluation

The key design principle is:

The LLM is one bounded reasoning component inside a larger backend workflow, not the whole system.

⸻

3. Target Technical Positioning

This project is designed to demonstrate skills relevant to:

* AI Agent Developer
* AI Application Developer
* LLM Application Engineer
* Backend Engineer with GenAI experience
* AI Workflow Engineer
* Automation Platform Engineer
* Full-Stack / Backend Engineer working on AI-enabled systems

The project should show:

* backend architecture
* workflow orchestration
* async workers
* semantic retrieval
* vector database usage
* structured LLM outputs
* tool-based agent design
* event modelling
* deduplication
* evaluation methodology
* operational reliability

⸻

4. Technology Stack

Backend

TypeScript
Node.js

Database

PostgreSQL + pgvector

PostgreSQL is the source of truth.

pgvector is used for:

* article semantic retrieval
* event semantic retrieval
* event grouping candidate search
* semantic deduplication support

Queue

Redis + BullMQ

Redis/BullMQ is used for asynchronous job orchestration.

Web Extraction

HTTP fetch + Readability
Playwright fallback

HTTP extraction is the default path.

Playwright is only used as a controlled fallback for JavaScript-rendered or extraction-resistant pages.

LLM / AI

Use an LLM provider or internal model for:

* structured classification
* event comparison
* event summarisation
* material update detection

Use an embedding model for:

* article embeddings
* event embeddings
* semantic similarity search

Validation

Zod

Zod is used to validate structured LLM JSON outputs.

Logging

Pino

Pino is used for structured logs.

Local Development

Docker Compose

⸻

5. High-Level Architecture

RSS / Web Sources
        ↓
Ingestion Worker
        ↓
Raw Article Registry
        ↓
Content Extraction Worker
        ↓
Entity Detection Worker
        ↓
Embedding Worker
        ↓
Semantic Retrieval
        ↓
Deduplication Worker
        ↓
Event Grouping Worker
        ↓
LLM Classification / Comparison / Summary
        ↓
Review / Notification Decision
        ↓
Evaluation / Metrics

Each stage should be:

* independently retryable
* idempotent
* observable
* auditable
* failure-isolated

⸻

6. Core Design Principle: Articles vs Events

The most important architectural decision is to separate articles from events.

Article

An article is a source document.

Examples:

Article A: "Company X confirms service disruption"
Article B: "Multiple sources report Company X outage"
Article C: "Company X publishes investigation update"

Event

An event is the real-world happening.

The above three articles may all belong to one event:

Event: Company X service disruption and follow-up investigation

The system should not treat every article as a separate event.

Instead, it should create or update event records based on semantic similarity, deterministic deduplication, metadata comparison, and structured LLM reasoning.

⸻

7. Key System Capabilities

7.1 RSS / Web Ingestion

The ingestion worker should:

* fetch configured RSS feeds
* parse RSS items
* normalise URLs
* generate URL hash
* generate title hash
* store raw article metadata
* skip exact URL duplicates
* track ingestion status

Initial article status:

NEW

⸻

7.2 Hybrid Content Extraction

The extraction layer should use a hybrid strategy:

1. Use RSS summary if sufficient
2. Try HTTP fetch
3. Parse with Readability
4. Use source-specific extractor if configured
5. Use Playwright fallback if static extraction fails

HTTP extraction should be the default because it is cheaper and faster.

Playwright should be used only for:

* JavaScript-rendered pages
* pages where static HTML does not contain usable article content
* pages requiring interaction before content appears
* source-specific pages known to fail HTTP extraction

Track:

extraction_status
extraction_method
extraction_error
extracted_at
content_quality_score

Extraction statuses:

pending
rss_only
http_success
http_failed
playwright_success
playwright_failed
skipped

⸻

7.3 Entity Detection

The entity detection worker should extract structured entities from articles.

Possible entities:

company
vendor
product
person
location
topic
regulation
policy
financial instrument
technology
CVE
IOC
date
event type

For the initial demo, the project may focus on company/vendor/product/news-event extraction.

Entity records should be stored separately from article text.

This allows semantic search, filtering, and event grouping to use structured metadata.

⸻

7.4 Embedding Generation

The embedding worker should generate embeddings for useful content only.

Rules:

* Do not embed exact duplicates.
* Do not embed articles with poor content quality.
* Prefer clean article text.
* If the article is too long, truncate or summarise before embedding.
* Store embedding in PostgreSQL using pgvector.
* Generate both article embeddings and event embeddings.

Embedding types:

article_embedding
event_embedding

Event embedding should be generated from:

event title
event summary
key entities
event type
source context

⸻

7.5 Semantic Retrieval

The retrieval layer should support two modes.

Article Retrieval

Used for finding similar source documents.

Example:

Find articles similar to this new article.

Event Retrieval

Used for finding whether a new article belongs to an existing event.

Example:

Has this real-world event already been seen?

Event retrieval is more important for scalability because it avoids unbounded article-to-article comparison.

Recommended retrieval flow:

New article
    ↓
Generate article embedding
    ↓
Search similar recent events using event_embedding
    ↓
Search similar recent articles only if needed
    ↓
Compare top candidates
    ↓
Attach to existing event or create new event

⸻

7.6 Layered Deduplication

Deduplication should not rely on vector similarity alone.

Use a layered approach:

Layer 1: Exact Deduplication

Use:

canonical_url
url_hash
content_hash

Layer 2: Near-Duplicate Detection

Use:

title normalisation
title similarity
same source family
same time window

Layer 3: Semantic Candidate Retrieval

Use:

pgvector similarity search
metadata filters
recent time window
event embeddings

Layer 4: Structured LLM Comparison

Only use LLM comparison for ambiguous cases.

LLM should classify relationships as:

same_article
same_event
related_but_different_event
material_update
unrelated

The key principle:

Vector search generates candidates. It should not be the final judge.

⸻

7.7 Event Grouping

The event grouping worker should:

* search similar existing events
* compare new article with top candidate events
* attach article to an existing event if it describes the same event
* create a new event if no match exists
* update event summary
* update event embedding
* update event status
* identify whether the new article is a material update

Material update examples:

new source confirmation
severity escalation
new affected entity
new timeline detail
official statement
new regulatory update
new market impact
new product impact

⸻

7.8 Bounded LLM Reasoning

The LLM should not be used as the first step.

Use deterministic filters first.

LLM should be used for:

* structured article classification
* event comparison
* event summarisation
* material update detection
* notification decision support

LLM output must be:

* strict JSON
* schema-validated with Zod
* stored for audit
* linked to prompt version
* linked to model name
* linked to source article/event

Avoid free-form LLM outputs in core workflow logic.

⸻

7.9 Human-in-the-Loop Review

The system should support review states.

Possible review outcomes:

AUTO_NOTIFY
REVIEW_REQUIRED
IGNORE
LOW_CONFIDENCE
AMBIGUOUS_EVENT_MATCH
LOW_TRUST_SOURCE

Send items to review when:

* confidence is low
* source trust is low
* event matching is ambiguous
* LLM output fails validation
* article extraction quality is poor
* the system detects a potentially material update but confidence is not high enough

This demonstrates enterprise AI safety and practical workflow control.

⸻

7.10 Notification Decisioning

The system should not notify for every article.

Notify only when:

event is new
OR event has materially changed
AND confidence is above threshold
AND source trust is acceptable
AND duplicate notification has not been sent recently

Suppress notification when:

same event was already notified recently
article is an exact duplicate
article is low-confidence
source is low-trust and uncorroborated
event update is not material

Notification output for MVP can be:

* database record
* console output
* JSON file

Future notification channels:

* email
* Slack
* Microsoft Teams
* dashboard
* webhook
* ticketing system

⸻

8. Agent Tool Abstraction

To make the system closer to an AI agent architecture, define clear tools.

Possible tools:

fetchFeedTool
extractArticleTool
detectEntityTool
generateEmbeddingTool
retrieveSimilarArticlesTool
retrieveSimilarEventsTool
compareEventTool
summarizeEventTool
decideNotificationTool
runEvaluationTool

The system should use controlled tools rather than giving the LLM unrestricted control.

The agent workflow should be deterministic at the orchestration level and use LLM reasoning only in bounded steps.

Example:

Agent workflow:
1. Fetch feed items
2. Extract article content
3. Detect entities
4. Retrieve similar events
5. Ask LLM to compare only top candidates
6. Update event record
7. Decide notification status
8. Store audit trail

This shows that the project is an AI agent workflow, not just an LLM API wrapper.

⸻

9. Database Schema

9.1 Enable pgvector

CREATE EXTENSION IF NOT EXISTS vector;

⸻

9.2 Feeds

CREATE TABLE feeds (
  id BIGSERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  feed_url TEXT NOT NULL UNIQUE,
  source_type TEXT,
  trust_level TEXT DEFAULT 'medium',
  is_active BOOLEAN DEFAULT true,
  last_fetched_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

⸻

9.3 Articles

CREATE TABLE articles (
  id BIGSERIAL PRIMARY KEY,
  feed_id BIGINT REFERENCES feeds(id),
  source_name TEXT,
  title TEXT,
  canonical_url TEXT UNIQUE,
  final_url TEXT,
  url_hash TEXT,
  title_hash TEXT,
  content_hash TEXT,
  rss_summary TEXT,
  raw_html TEXT,
  clean_text TEXT,
  published_at TIMESTAMP,
  fetched_at TIMESTAMP DEFAULT now(),
  extraction_status TEXT DEFAULT 'pending',
  extraction_method TEXT,
  extraction_error TEXT,
  extracted_at TIMESTAMP,
  content_quality_score NUMERIC,
  processing_status TEXT DEFAULT 'new',
  processing_error TEXT,
  retry_count INT DEFAULT 0,
  next_retry_at TIMESTAMP,
  last_processed_at TIMESTAMP,
  embedding vector(1536),
  llm_classification JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

⸻

9.4 Article Entities

CREATE TABLE article_entities (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT REFERENCES articles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_value TEXT NOT NULL,
  confidence NUMERIC,
  role TEXT,
  created_at TIMESTAMP DEFAULT now()
);

Entity types may include:

company
vendor
product
topic
policy
regulation
event_type
location
person
date
technology

⸻

9.5 Events

CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  event_title TEXT,
  event_summary TEXT,
  event_status TEXT DEFAULT 'open',
  event_type TEXT,
  priority TEXT,
  confidence NUMERIC,
  first_seen_at TIMESTAMP,
  last_seen_at TIMESTAMP,
  key_entities TEXT[],
  topics TEXT[],
  source_count INT DEFAULT 0,
  event_embedding vector(1536),
  llm_summary JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

⸻

9.6 Event Articles

CREATE TABLE event_articles (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT REFERENCES events(id) ON DELETE CASCADE,
  article_id BIGINT REFERENCES articles(id) ON DELETE CASCADE,
  relationship TEXT,
  confidence NUMERIC,
  is_primary_source BOOLEAN DEFAULT false,
  is_material_update BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

Relationship values:

same_event
duplicate_article
related_context
primary_source
follow_up
material_update
unrelated

⸻

9.7 Notifications

CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT REFERENCES events(id) ON DELETE CASCADE,
  notification_status TEXT,
  notification_channel TEXT,
  notification_reason TEXT,
  priority TEXT,
  suppressed BOOLEAN DEFAULT false,
  suppression_reason TEXT,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

⸻

9.8 LLM Audit Records

CREATE TABLE llm_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT REFERENCES articles(id),
  event_id BIGINT REFERENCES events(id),
  task_type TEXT NOT NULL,
  prompt_version TEXT,
  model_name TEXT,
  input_hash TEXT,
  raw_output JSONB,
  parsed_output JSONB,
  validation_status TEXT,
  validation_error TEXT,
  confidence NUMERIC,
  created_at TIMESTAMP DEFAULT now()
);

⸻

9.9 Evaluation Results

CREATE TABLE evaluation_runs (
  id BIGSERIAL PRIMARY KEY,
  run_name TEXT,
  dataset_name TEXT,
  duplicate_reduction_rate NUMERIC,
  event_grouping_precision NUMERIC,
  classification_precision NUMERIC,
  false_positive_rate NUMERIC,
  llm_call_reduction_rate NUMERIC,
  extraction_success_rate NUMERIC,
  median_source_to_notification_latency_seconds NUMERIC,
  created_at TIMESTAMP DEFAULT now()
);

⸻

10. Recommended Indexes

CREATE INDEX idx_articles_published_at
ON articles (published_at DESC);
CREATE INDEX idx_articles_canonical_url
ON articles (canonical_url);
CREATE INDEX idx_articles_url_hash
ON articles (url_hash);
CREATE INDEX idx_articles_content_hash
ON articles (content_hash);
CREATE INDEX idx_articles_title_hash
ON articles (title_hash);
CREATE INDEX idx_articles_processing_status
ON articles (processing_status);
CREATE INDEX idx_articles_extraction_status
ON articles (extraction_status);
CREATE INDEX idx_article_entities_type_value
ON article_entities (entity_type, entity_value);
CREATE INDEX idx_events_last_seen
ON events (last_seen_at DESC);
CREATE INDEX idx_events_type
ON events (event_type);
CREATE INDEX idx_events_priority
ON events (priority);
CREATE INDEX idx_events_key_entities
ON events USING GIN (key_entities);
CREATE INDEX idx_articles_embedding
ON articles USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_events_embedding
ON events USING hnsw (event_embedding vector_cosine_ops);

⸻

11. Processing State Machine

Avoid simple boolean fields like:

processed = true / false

Use explicit states.

Article Processing Status

NEW
INGESTED
DUPLICATE_URL
EXTRACTION_PENDING
EXTRACTION_SUCCESS
EXTRACTION_FAILED
ENTITY_DETECTION_PENDING
ENTITY_DETECTED
EMBEDDING_PENDING
EMBEDDED
DEDUP_PENDING
DEDUPED
EVENT_GROUPING_PENDING
GROUPED
CLASSIFICATION_PENDING
CLASSIFIED
NOTIFICATION_CANDIDATE
NOTIFIED
REVIEW_REQUIRED
IGNORED
FAILED

Event Status

open
monitoring
closed
ignored
review_required

Notification Status

pending
sent
suppressed
failed
review_required

⸻

12. Worker Design

Use BullMQ workers.

Recommended queues:

ingest-queue
extraction-queue
entity-detection-queue
embedding-queue
dedup-queue
event-grouping-queue
llm-queue
notification-queue
evaluation-queue

Each worker should:

1. Load the relevant article or event.
2. Check current processing status.
3. Execute one task only.
4. Save result.
5. Update status.
6. Push next job if successful.
7. Retry on retryable failure.
8. Mark as failed or review-required after max retries.

Workers must be idempotent.

⸻

13. LLM Output Schemas

13.1 Article Classification Schema

{
  "is_relevant": true,
  "event_type": "market_update",
  "key_entities": [
    {
      "name": "Company X",
      "type": "company",
      "role": "affected",
      "confidence": 0.86
    }
  ],
  "topics": ["market", "technology", "regulation"],
  "priority": "medium",
  "confidence": 0.82,
  "reason": "The article describes a material update involving a tracked entity."
}

⸻

13.2 Event Comparison Schema

{
  "relationship": "same_event",
  "confidence": 0.89,
  "should_attach_to_event": true,
  "is_material_update": true,
  "material_update_reason": "The new article provides official confirmation and adds timeline details.",
  "reason": "Both records describe the same real-world event involving the same entity within the same time window."
}

⸻

13.3 Event Summary Schema

{
  "event_title": "Company X announces major product update",
  "event_summary": "Multiple sources report that Company X has announced a significant product update, with follow-up details from official sources.",
  "key_entities": ["Company X", "Product Y"],
  "topics": ["product update", "market impact"],
  "priority": "medium",
  "confidence": 0.84
}

⸻

13.4 Notification Decision Schema

{
  "should_notify": true,
  "priority": "medium",
  "reason": "This is a new event involving a tracked entity and has not been previously notified.",
  "requires_review": false,
  "suppression_reason": null,
  "confidence": 0.81
}

⸻

14. Evaluation Module

The evaluation module is required for the 9/10 version.

Create a command:

npm run eval

It should evaluate the pipeline using a labelled dataset.

Labelled Dataset

Store under:

data/labelled-eval-set.json

Each labelled item should include:

{
  "article_id": "sample-001",
  "title": "Example article title",
  "url": "https://example.com/article",
  "content": "Article text...",
  "expected_event_group": "event-001",
  "is_duplicate": false,
  "is_relevant": true,
  "expected_priority": "medium"
}

Evaluation Metrics

Measure:

duplicate_reduction_rate
event_grouping_precision
classification_precision
false_positive_rate
llm_call_reduction_rate
extraction_success_rate
source_to_notification_latency

Why Evaluation Matters

The goal is to show that the project is not only functional, but measurable.

The system should be judged by output quality, not only by whether it runs.

⸻

15. Observability

Minimum logs:

feed_fetched
article_discovered
article_skipped_duplicate
article_extraction_success
article_extraction_failed
entity_detected
embedding_generated
similar_article_found
similar_event_found
llm_classification_completed
event_created
event_updated
notification_sent
notification_suppressed
evaluation_completed

Minimum metrics:

articles_fetched_total
articles_created_total
articles_deduped_total
extraction_failed_total
playwright_used_total
llm_calls_total
events_created_total
events_updated_total
notifications_sent_total
notifications_suppressed_total
average_pipeline_latency_seconds
source_to_notification_latency_seconds

Most important metric:

source_to_notification_latency_seconds

⸻

16. Error Handling

Each processing stage should support retries and failure isolation.

Recommended retry policy:

RSS fetch failed:
- retry 3 times
- log feed error
- continue other feeds
HTTP extraction failed:
- fallback to Playwright
Playwright extraction failed:
- retry 1–2 times
- mark extraction_failed
- keep article metadata
Embedding failed:
- retry with exponential backoff
- do not delete article
LLM failed:
- retry with exponential backoff
- mark review_required if still failing
Notification failed:
- retry
- mark notification failed after final attempt

Never lose article metadata because downstream processing fails.

⸻

17. Project Folder Structure

ai-event-intelligence-agent/
  src/
    app.ts
    config/
      env.ts
      feeds.ts
    db/
      pool.ts
      migrations/
      repositories/
        article.repository.ts
        event.repository.ts
        feed.repository.ts
        notification.repository.ts
        evaluation.repository.ts
        llm-audit.repository.ts
    ingestion/
      rss-fetcher.ts
      feed-normalizer.ts
    extraction/
      article-extractor.interface.ts
      http-article-extractor.ts
      playwright-article-extractor.ts
      extraction-router.ts
      content-cleaner.ts
      url-normalizer.ts
    detection/
      entity-detector.ts
      keyword-detector.ts
      topic-detector.ts
    embedding/
      embedding-client.ts
      embedding-worker.ts
    retrieval/
      article-retriever.ts
      event-retriever.ts
    dedup/
      exact-dedup.ts
      title-dedup.ts
      semantic-dedup.ts
    events/
      event-grouper.ts
      event-updater.ts
      event-summary-builder.ts
    llm/
      classifier.ts
      event-comparator.ts
      summarizer.ts
      notification-decider.ts
      schemas.ts
      prompt-versions.ts
    notifications/
      notification-decision.ts
      notification-suppression.ts
      notification-output.ts
    evaluation/
      evaluator.ts
      metrics.ts
      labelled-dataset-loader.ts
    queue/
      queue.ts
      jobs.ts
      workers/
        ingest-worker.ts
        extraction-worker.ts
        entity-detection-worker.ts
        embedding-worker.ts
        dedup-worker.ts
        event-grouping-worker.ts
        llm-worker.ts
        notification-worker.ts
        evaluation-worker.ts
    cli/
      ingest.ts
      process.ts
      search.ts
      events.ts
      eval.ts
    types/
      article.ts
      event.ts
      entity.ts
      notification.ts
      llm.ts
      evaluation.ts
    utils/
      hash.ts
      logger.ts
      date.ts
      retry.ts
  docs/
    architecture.md
    data-model.md
    evaluation.md
    tradeoffs.md
    limitations.md
  data/
    sample-feeds.json
    labelled-eval-set.json
  scripts/
    seed.ts
    run-eval.ts
  docker-compose.yml
  package.json
  tsconfig.json
  .env.example
  README.md

⸻

18. CLI Commands

The project should expose simple CLI commands for demonstration.

npm run ingest

Fetch RSS feeds and store new articles.

npm run process

Run the processing pipeline for pending articles.

npm run search -- "AI regulation update"

Search semantically similar articles/events.

npm run events -- --days 7

Show recent grouped events.

npm run eval

Run evaluation on labelled dataset.

These commands make the project easy to demo without building a frontend.

⸻

19. Docker Compose

version: "3.9"
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: ai_event_postgres
    environment:
      POSTGRES_USER: ai_event
      POSTGRES_PASSWORD: ai_event
      POSTGRES_DB: ai_event_agent
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
  redis:
    image: redis:7
    container_name: ai_event_redis
    ports:
      - "6379:6379"
volumes:
  postgres_data:

⸻

20. Environment Variables

Create .env.example.

DATABASE_URL=postgres://ai_event:ai_event@localhost:5432/ai_event_agent
REDIS_HOST=localhost
REDIS_PORT=6379
OPENAI_API_KEY=replace_me
EMBEDDING_MODEL=text-embedding-3-small
LLM_MODEL=gpt-4.1-mini
RSS_FETCH_INTERVAL_MINUTES=30
HTTP_EXTRACTION_CONCURRENCY=10
PLAYWRIGHT_EXTRACTION_CONCURRENCY=2
LLM_CONCURRENCY=3
NOTIFICATION_SUPPRESSION_HOURS=6
MIN_NOTIFICATION_CONFIDENCE=0.75

⸻

21. README Requirements

The README should include:

1. Problem Statement
2. Why Simple RSS + LLM Summary Is Not Enough
3. Architecture Overview
4. Data Model
5. Agent Workflow
6. Deduplication Strategy
7. LLM Orchestration Strategy
8. Evaluation Methodology
9. Sample Outputs
10. Trade-offs
11. Limitations
12. Future Improvements

⸻

22. Architecture Trade-offs

Document these trade-offs in docs/tradeoffs.md.

PostgreSQL + pgvector vs Dedicated Vector DB

PostgreSQL + pgvector is chosen because the system is state-heavy and audit-heavy. It needs relational data, processing states, article/event lineage, structured entities, and semantic retrieval in one source of truth.

A dedicated vector database may be introduced later if vector search scale becomes the primary bottleneck.

Playwright Fallback vs Default Browser Extraction

Playwright is powerful but expensive and fragile. HTTP extraction is faster and cheaper, so Playwright is used only as a controlled fallback.

Event-Level Embedding vs Article-Only Embedding

Article-only comparison becomes expensive as volume grows. Event-level embeddings allow new articles to be compared against compact event representations.

LLM as Bounded Reasoning Layer

The LLM is not used as the first filter. Deterministic filters and retrieval narrow the decision space before LLM reasoning is used.

Modular Monolith vs Microservices

The initial system is built as a modular monolith with workers. This avoids premature distributed-system complexity while preserving clear module boundaries.

⸻

23. Limitations

Document these limitations in docs/limitations.md.

- RSS feeds may not capture all real-time information.
- Some websites may block extraction or change layouts.
- Playwright extraction is slower and more fragile than static extraction.
- LLM classification may still misclassify ambiguous articles.
- Event grouping quality depends on embedding quality and labelled evaluation coverage.
- Semantic similarity alone is insufficient for final event grouping.
- The current MVP does not include a full analyst review UI.
- The system requires source trust configuration for high-quality notification decisions.

⸻

24. Future Improvements

Possible future improvements:

- Web dashboard for event review
- Human feedback loop for improving classification
- Active learning from review decisions
- Source trust scoring model
- Multi-domain configuration
- Elasticsearch integration for richer keyword search
- Qdrant integration for larger-scale vector retrieval
- Scheduled evaluation reports
- Teams or email notification integration
- Policy/regulatory monitoring domain pack
- Financial news monitoring domain pack

⸻

25. MVP Implementation Order

Phase 1: Foundation

- Initialise TypeScript project
- Add Docker Compose
- Add PostgreSQL + pgvector
- Add Redis
- Add database connection
- Add migration setup
- Create base schema

Phase 2: Ingestion

- Implement RSS fetcher
- Implement feed normaliser
- Implement URL normalisation
- Generate hashes
- Store new articles
- Skip exact duplicates

Phase 3: Extraction

- Implement HTTP extractor
- Implement Readability parser
- Implement Playwright extractor
- Implement extraction router
- Track extraction method/status/errors

Phase 4: Entity Detection

- Implement keyword/entity detector
- Store article entities
- Add topic detection

Phase 5: Embedding + Retrieval

- Implement embedding client
- Store article embeddings
- Implement article similarity search
- Implement event similarity search

Phase 6: Deduplication + Event Grouping

- Implement exact dedup
- Implement title similarity
- Implement semantic candidate retrieval
- Create event records
- Attach articles to events
- Generate event embeddings

Phase 7: LLM Reasoning

- Implement classification prompt
- Implement event comparison prompt
- Implement summarisation prompt
- Validate JSON with Zod
- Store LLM audit logs

Phase 8: Notification Decision

- Implement notification rules
- Implement suppression logic
- Store notification records
- Output notification JSON/console logs

Phase 9: Evaluation

- Create labelled dataset
- Implement evaluation script
- Measure duplicate reduction
- Measure event grouping precision
- Measure classification precision
- Measure false positive rate
- Measure LLM call efficiency
- Measure extraction success rate

Phase 10: Documentation

- Write README
- Write architecture.md
- Write data-model.md
- Write evaluation.md
- Write tradeoffs.md
- Write limitations.md

⸻

26. Initial Setup Commands

mkdir ai-event-intelligence-agent
cd ai-event-intelligence-agent
npm init -y
npm install typescript tsx dotenv zod
npm install rss-parser
npm install pg
npm install bullmq ioredis
npm install playwright
npm install cheerio jsdom @mozilla/readability
npm install pino
npm install uuid
npm install openai
npm install -D @types/node
npm install -D @types/pg
npm install -D @types/jsdom
npm install -D vitest
npx tsc --init
npx playwright install chromium

⸻

27. CV Positioning

Use this project description on CV:

AI Event Intelligence Agent
Built a production-oriented AI workflow system that converts noisy RSS/web content into structured, deduplicated, event-level intelligence records using TypeScript, PostgreSQL/pgvector, Redis/BullMQ, Playwright, and schema-validated LLM outputs.
- Architected an event-centric data model separating articles, entities, embeddings, event records, article-to-event lineage, LLM outputs, and notification decisions.
- Built a staged, idempotent agent workflow for ingestion, extraction, entity detection, embedding, semantic retrieval, event grouping, LLM classification, summarisation, and notification decisioning.
- Implemented HTTP/Readability extraction with Playwright fallback for JavaScript-rendered pages, including timeout handling, extraction status tracking, and content quality scoring.
- Developed layered deduplication using URL normalisation, content hashing, title similarity, metadata-scoped pgvector retrieval, event-level embeddings, and structured LLM comparison.
- Designed bounded LLM orchestration with deterministic pre-filters, tool-based workflow steps, schema-validated JSON outputs, confidence scoring, prompt versioning, raw output audit storage, and duplicate notification suppression.
- Built an evaluation module measuring duplicate reduction, event grouping precision, classification precision, false-positive rate, LLM call efficiency, extraction success rate, and source-to-notification latency.

⸻

28. Interview Explanation

Use this explanation in interviews:

The main challenge was not calling an LLM. The challenge was designing the surrounding workflow: how to ingest noisy web content, extract usable text, avoid duplicate records, separate articles from real-world events, retrieve semantically related records, use LLMs only for bounded reasoning, and evaluate output quality.
I treated the LLM as one reasoning component inside a larger backend workflow, not as the whole system. Deterministic rules handle obvious cases, pgvector retrieves semantic candidates, and the LLM is only used for structured classification and ambiguous event comparison.

⸻

29. Definition of Done for 9/10 Version

The project is considered 9/10 CV-ready when it has:

- Working RSS ingestion
- Working HTTP extraction
- Working Playwright fallback
- PostgreSQL + pgvector schema
- Article/event separation
- Entity extraction
- Article embeddings
- Event embeddings
- Semantic event retrieval
- Layered deduplication
- Structured LLM classification
- Zod validation
- LLM audit logging
- Notification suppression
- Evaluation script
- Sample labelled dataset
- README with architecture explanation
- docs/tradeoffs.md
- docs/limitations.md
- CLI demo commands

Frontend is optional and should not be prioritised before the backend workflow, evaluation, and documentation are complete.

⸻

30. Final Architecture Summary

PostgreSQL + pgvector
= source of truth, article/event state, semantic retrieval
Redis + BullMQ
= asynchronous workflow orchestration
HTTP + Readability
= default article extraction
Playwright
= controlled fallback extraction
LLM
= bounded reasoning for classification, comparison, summarisation, and decisioning
Zod
= schema validation for AI outputs
Evaluation module
= measurable quality control

The project should demonstrate that AI agents are not just chatbots. They are workflow systems with tools, state, retrieval, reasoning, guardrails, and measurable output quality.