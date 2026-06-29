# Implementation Plan: RSS + pgvector Threat Intelligence Pipeline

## Overview

Build the current `vendor-threat-watch` prototype into a modular backend pipeline that ingests RSS cyber news, extracts article content, detects vendor/product relevance, stores embeddings in PostgreSQL with pgvector, deduplicates articles, groups them into cyber events, and emits alert decisions only when a credible cyber event appears to affect monitored vendors or products.

The existing app already has TypeScript, RSS feed config, vendor inventory, LLM helpers, embedding support, Qdrant-based vector dedup, and in-memory storage. This plan evolves that prototype in place. PostgreSQL becomes the source of truth, pgvector replaces Qdrant for MVP semantic retrieval, and queues/workers are introduced after the core synchronous path is proven.

## Architecture Decisions

- Use PostgreSQL + pgvector as the source of truth for articles, vendors, events, entities, classifications, and alerts.
- Keep Qdrant code temporarily behind a storage boundary, then remove or deprecate it once pgvector event/article search is verified.
- Build a synchronous pipeline runner first, then wrap the same stage functions in BullMQ workers. This keeps early testing simple while preserving the staged architecture.
- Separate articles from cyber events. Articles are source documents; events are real-world incidents or vulnerabilities.
- Use cheap deterministic filters before embeddings and LLM calls.
- Use LLMs only for classification, event comparison, summarization, and ambiguous cases.
- Store raw LLM JSON outputs for auditability and extract important fields into relational columns.

## Phase 1: Database Foundation

### Task 1: Add Local Infrastructure Config

**Status:** Completed in commit `4fc85c4`.

**Description:** Add local development services for PostgreSQL with pgvector and Redis.

**Acceptance Criteria:**
- `docker-compose.yml` starts Postgres with pgvector and Redis.
- `.env.example` documents database, Redis, embedding, LLM, extraction, and alert settings.
- Existing Qdrant settings remain until pgvector replacement is complete.

**Verification:**
- `docker compose config` succeeds.
- Postgres and Redis containers start locally.

**Dependencies:** None

**Files Likely Touched:**
- `docker-compose.yml`
- `.env.example`
- `README.md`

**Estimated Scope:** Small

### Task 2: Add PostgreSQL Connection and Migration Runner

**Status:** Completed in commit `4fc85c4`.

**Description:** Introduce a small database layer with a pooled Postgres connection and a migration script.

**Acceptance Criteria:**
- A `pg` pool is configured from `DATABASE_URL`.
- A migration runner applies SQL migrations in order and records applied migration names.
- The app fails clearly when `DATABASE_URL` is missing in database-backed modes.

**Verification:**
- `npm run check`
- Migration runner can create the migration metadata table.

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/db/pool.ts`
- `src/db/migrations/*.sql`
- `scripts/migrate.ts`
- `src/config/env.ts`
- `package.json`

**Estimated Scope:** Medium

### Task 3: Create Core Schema

**Status:** Completed in commit `4fc85c4`.

**Description:** Add tables and indexes for feeds, vendors, articles, entities, events, event/article relationships, and alerts.

**Acceptance Criteria:**
- pgvector extension is enabled.
- Tables exist for `vendors`, `vendor_aliases`, `vendor_products`, `vendor_product_aliases`, `feeds`, `articles`, `article_entities`, `cyber_events`, `event_articles`, and `alerts`.
- HNSW vector indexes exist for article and event embeddings.
- Status columns support the design's processing lifecycle.

**Verification:**
- Migration runs from an empty database.
- Re-running migrations is safe.

**Dependencies:** Task 2

**Files Likely Touched:**
- `src/db/migrations/*.sql`
- `docs/architecture.md`

**Estimated Scope:** Medium

### Checkpoint: Database Foundation

- [x] Local Postgres 18 with pgvector and Redis 8 run.
- [x] Migrations apply cleanly and are idempotent.
- [x] Existing offline tests pass with live MiniMax tests skipped.
- [x] `npm run check` passes.

## Phase 2: Seed Data and Repositories

### Task 4: Add Feed and Vendor Seed Scripts

**Status:** Completed.

**Description:** Move configured RSS feeds and monitored vendors into seedable database records.

**Acceptance Criteria:**
- Existing `src/config/rssFeeds.ts` feeds are seeded into `feeds`.
- Existing `src/storage/vendorInventory.ts` vendors/products/aliases are seeded into vendor tables.
- Seed scripts are idempotent.

**Verification:**
- Running seeds twice does not create duplicates.
- Seeded records match existing config values.

**Dependencies:** Task 3

**Files Likely Touched:**
- `scripts/seed-feeds.ts`
- `scripts/seed-vendors.ts`
- `src/config/rssFeeds.ts`
- `src/storage/vendorInventory.ts`

**Estimated Scope:** Medium

### Task 5: Add Repository Layer

**Status:** Completed.

**Description:** Add repository classes for database reads/writes while keeping business logic out of persistence code.

**Acceptance Criteria:**
- Repositories exist for feeds, vendors, articles, entities, events, and alerts.
- Repositories expose typed methods used by pipeline stages.
- Repository tests cover duplicate URL handling and vendor lookup.

**Verification:**
- `npm test`
- `npm run check`

**Dependencies:** Task 3

**Files Likely Touched:**
- `src/db/repositories/*.ts`
- `tests/repositories.test.ts`

**Estimated Scope:** Medium

### Checkpoint: Data Access

- [x] Seed data loads into Postgres.
- [x] Repository tests cover duplicate article URL handling and vendor/product alias lookup.
- [x] In-memory store remains available for the legacy graph flow and tests.

**Verification Completed:**
- `npm run check`
- `env MINIMAX_API_KEY= DATABASE_URL=postgres://cyber:cyber@localhost:5432/vendor_threat_watch npm test`
- `env DATABASE_URL=postgres://cyber:cyber@localhost:5432/vendor_threat_watch npm run db:seed`
- Seed counts after repeated runs: 4 feeds, 4 vendors, 4 products, 13 product aliases.

## Phase 3: RSS Ingestion

### Task 6: Implement URL Normalization and Hashing

**Status:** Completed.

**Description:** Add deterministic URL normalization, title normalization, URL hash, title hash, and content hash helpers.

**Acceptance Criteria:**
- Tracking query params are removed.
- URLs normalize consistently across trailing slashes, fragments, and casing where safe.
- Hash helpers are deterministic.
- Unit tests cover normalization edge cases.

**Verification:**
- `npm test -- url`
- `npm run check`

**Dependencies:** None

**Files Likely Touched:**
- `src/extraction/url-normalizer.ts`
- `src/utils/hash.ts`
- `tests/url-normalizer.test.ts`

**Estimated Scope:** Small

### Task 7: Implement RSS Ingestion Stage

**Status:** Completed.

**Description:** Fetch active RSS feeds, normalize items, store new article metadata, and skip exact URL duplicates.

**Acceptance Criteria:**
- RSS items are stored with `processing_status = 'NEW'`.
- Existing canonical URLs are skipped and logged.
- Feed `last_fetched_at` is updated.
- Network/feed errors are recorded without deleting existing data.

**Verification:**
- Unit tests use RSS parser fixtures.
- Manual run inserts articles from configured feeds.

**Dependencies:** Tasks 4, 5, 6

**Files Likely Touched:**
- `src/rss/rss-fetcher.ts`
- `src/rss/feed-normalizer.ts`
- `src/pipeline/ingest-stage.ts`
- `scripts/run-ingest.ts`
- `tests/rss-ingestion.test.ts`

**Estimated Scope:** Medium

### Checkpoint: Ingestion

- [x] RSS ingestion can populate Postgres.
- [x] Exact URL duplicates are skipped.
- [x] Logs include feed fetched, article discovered, and duplicate skipped events.

**Verification Completed:**
- `npm run check`
- `npx vitest run tests/url-normalizer.test.ts`
- `env DATABASE_URL=postgres://cyber:cyber@localhost:5432/vendor_threat_watch npx vitest run tests/rss-ingestion.test.ts`
- `env MINIMAX_API_KEY= DATABASE_URL=postgres://cyber:cyber@localhost:5432/vendor_threat_watch npm test`
- `env DATABASE_URL=postgres://cyber:cyber@localhost:5432/vendor_threat_watch npm run ingest:rss -- --feed-url=https://www.cisa.gov/cybersecurity-advisories/all.xml`
- Live CISA ingest first run: 30 fetched, 30 created, 0 duplicates, 0 skipped, 0 errors.
- Live CISA ingest second run: 30 fetched, 0 created, 30 duplicates, 0 skipped, 0 errors.

## Phase 4: Article Extraction and Cheap Filtering

### Task 8: Implement Cheap Pre-Filter

**Status:** Completed.

**Description:** Add deterministic cyber keyword, CVE pattern, attack phrase, vendor, and product matching before expensive extraction or LLM calls.

**Acceptance Criteria:**
- Articles with strong RSS summary/title signals advance to extraction.
- Articles with no cyber/vendor/product signal can be marked ignored or low priority.
- Detected cheap-filter reasons are stored or logged.

**Verification:**
- Unit tests cover cyber keywords, CVEs, vendor aliases, product aliases, and false positives.

**Dependencies:** Tasks 5, 7

**Files Likely Touched:**
- `src/detection/cyber-keyword-detector.ts`
- `src/detection/vendor-detector.ts`
- `src/detection/cve-extractor.ts`
- `src/pipeline/filter-stage.ts`
- `tests/detection.test.ts`

**Estimated Scope:** Medium

### Task 9: Implement HTTP Article Extraction

**Status:** Completed.

**Description:** Extract article content with HTTP fetch, HTML parsing, Readability, and content cleaning.

**Acceptance Criteria:**
- RSS summary is used when long enough.
- HTTP extraction stores `raw_html`, `clean_text`, `content_hash`, method, status, and errors.
- Short or failed extraction is marked for Playwright fallback.

**Verification:**
- Unit tests use local HTML fixtures.
- Manual extraction works for at least one static source.

**Dependencies:** Tasks 5, 6

**Files Likely Touched:**
- `src/extraction/article-extractor.interface.ts`
- `src/extraction/http-article-extractor.ts`
- `src/extraction/content-cleaner.ts`
- `src/pipeline/extraction-stage.ts`
- `tests/http-extractor.test.ts`

**Estimated Scope:** Medium

### Task 10: Implement Playwright Fallback Extractor

**Status:** Completed. Router and real Playwright fallback extractor exist.

**Description:** Add browser-based fallback extraction for pages where HTTP extraction fails or produces insufficient content.

**Acceptance Criteria:**
- Browser instance is reused.
- Per-article browser contexts are isolated and closed.
- Playwright fallback has timeout, retry, content length validation, and clear error logging.
- Playwright is used only when routed by extraction rules.

**Verification:**
- Manual extraction succeeds on one JavaScript-heavy page.
- Tests cover routing decisions without requiring live browser runs.

**Dependencies:** Task 9

**Files Likely Touched:**
- `src/extraction/playwright-article-extractor.ts`
- `src/extraction/extraction-router.ts`
- `tests/extraction-router.test.ts`

**Estimated Scope:** Medium

### Checkpoint: Extraction

- [x] Static articles extract through HTTP.
- [x] Difficult pages route to Playwright fallback extractor.
- [x] Failed extraction keeps article metadata and marks extraction failure status.

**Verification Completed:**
- `npm run check`
- `npx vitest run tests/detection.test.ts tests/extraction.test.ts`
- `env DATABASE_URL=postgres://cyber:cyber@localhost:5432/vendor_threat_watch npm run filter:articles -- --limit=10`
- `env DATABASE_URL=postgres://cyber:cyber@localhost:5432/vendor_threat_watch npm run extract:articles -- --limit=2`
- Local filter run: 10 reviewed, 9 extraction pending, 1 ignored.
- Local extraction run: 2 reviewed, 2 succeeded, 0 failed.
- `npx vitest run tests/playwright-extractor.test.ts`

## Phase 5: Entities, Embeddings, and Semantic Search

### Task 11: Store Entity Detection Results

**Status:** Completed.

**Description:** Extract and persist vendors, products, CVEs, IOCs, attack types, and initial roles from article content.

**Acceptance Criteria:**
- Entity rows are inserted idempotently per article.
- Vendor/product detection uses database aliases.
- CVE and basic IOC extraction work without LLM calls.

**Verification:**
- Unit tests cover entity extraction fixtures.
- Stored entities can be queried by vendor/product/CVE.

**Dependencies:** Tasks 5, 8, 9

**Files Likely Touched:**
- `src/detection/entity-extractor.ts`
- `src/detection/ioc-extractor.ts`
- `src/pipeline/entity-stage.ts`
- `tests/entity-extractor.test.ts`

**Estimated Scope:** Medium

### Task 12: Add pgvector Embedding Storage

**Status:** Completed. Article embedding storage and event embedding storage now both use pgvector-backed repository writes; live embedding runs require API credentials.

**Description:** Generate embeddings for extracted article text and store vectors in PostgreSQL.

**Acceptance Criteria:**
- Exact duplicates and insufficient-content articles are not embedded.
- Embedding input is cleaned and truncated to a safe length.
- Embedding dimension matches the migration configuration.
- Embedding failures are retryable and do not delete articles.

**Verification:**
- Unit tests mock the embedding client.
- Manual run stores at least one article embedding.

**Dependencies:** Tasks 3, 9, 11

**Files Likely Touched:**
- `src/embedding/embedding-client.ts`
- `src/pipeline/embedding-stage.ts`
- `src/db/repositories/article.repository.ts`
- `tests/embedding-stage.test.ts`

**Estimated Scope:** Medium

### Task 13: Implement Semantic Search Repositories

**Status:** Completed. Article and event similarity repository methods both return cosine distance metadata for downstream deduplication and grouping.

**Description:** Add pgvector candidate search for recent similar articles and events.

**Acceptance Criteria:**
- Similar article search scopes by recency and excludes the current article.
- Similar event search scopes by `last_seen_at`.
- Query methods return distance/score and metadata needed by dedup/grouping.

**Verification:**
- Repository tests use seeded vectors when pgvector is available.
- Query shape is documented.

**Dependencies:** Task 12

**Files Likely Touched:**
- `src/db/repositories/article.repository.ts`
- `src/db/repositories/event.repository.ts`
- `tests/vector-search.test.ts`

**Estimated Scope:** Medium

### Checkpoint: Semantic Retrieval

- [x] Articles can be embedded into Postgres with live credentials.
- [x] Similar article search returns plausible candidates.
- [x] Qdrant is no longer required for the main MVP path.

**Verification Completed:**
- `npm run check`
- `npx vitest run tests/entity-extractor.test.ts tests/embedding-stage.test.ts`
- `env DATABASE_URL=postgres://cyber:cyber@localhost:5432/vendor_threat_watch npm run entities:articles -- --limit=5`
- Local entity run: 2 reviewed, 19 entity rows stored.
- Added event embedding repository/stage coverage with `tests/event-embedding-stage.test.ts`.

## Phase 6: Deduplication and Event Grouping

### Task 14: Implement Layered Article Deduplication

**Status:** Completed. Exact content-hash duplicates and title-window near duplicates are marked before expensive downstream work; semantic matches are exposed as candidates only.

**Description:** Combine exact URL/content duplicate detection, title near-duplicate matching, and semantic candidate generation.

**Acceptance Criteria:**
- Exact duplicates are marked and excluded from downstream expensive work.
- Near duplicates are identified by normalized title and publication window.
- Semantic candidates are generated with pgvector but not treated as final truth by themselves.

**Verification:**
- Tests cover exact, title-near, semantic-candidate, and separate-article cases.

**Dependencies:** Tasks 6, 12, 13

**Files Likely Touched:**
- `src/dedup/exact-dedup.ts`
- `src/dedup/title-dedup.ts`
- `src/dedup/semantic-dedup.ts`
- `src/pipeline/dedup-stage.ts`
- `tests/dedup.test.ts`

**Estimated Scope:** Medium

### Task 15: Implement Basic Event Grouping

**Status:** Completed. Deterministic event draft creation, article-to-event attachment, stable grouping keys, duplicate skip behavior, and event embedding support are in place.

**Description:** Create or update cyber events from deduplicated, entity-enriched articles.

**Acceptance Criteria:**
- New relevant articles create cyber events.
- Similar articles attach to existing events when deterministic criteria are strong enough.
- Event rows track title, summary, severity, urgency, affected vendors/products, CVEs, source count, first seen, and last seen.
- Event embeddings are generated from event fields.

**Verification:**
- Tests cover create-event and attach-to-event flows.
- Manual run creates event/article relationships.

**Dependencies:** Tasks 11, 13, 14

**Files Likely Touched:**
- `src/events/event-grouper.ts`
- `src/events/event-updater.ts`
- `src/events/event-summary-builder.ts`
- `src/pipeline/event-stage.ts`
- `tests/event-grouper.test.ts`

**Estimated Scope:** Medium

### Task 16: Add LLM Event Comparison for Ambiguous Cases

**Status:** Deferred to Phase 7. The deterministic grouping layer now emits stable semantic candidates; schema-validated LLM comparison is implemented with the broader LLM reasoning work.

**Description:** Use strict JSON LLM comparison only when deterministic event grouping is uncertain.

**Acceptance Criteria:**
- LLM event comparator returns schema-validated JSON.
- Results classify `same_event`, `related_but_different_event`, or `unrelated`.
- Raw comparison output is stored for auditability.
- LLM is skipped for exact duplicates and clear non-matches.

**Verification:**
- Tests mock LLM responses and validation failures.
- Ambiguous fixture routes through comparator.

**Dependencies:** Task 15

**Files Likely Touched:**
- `src/llm/event-comparator.ts`
- `src/llm/schemas.ts`
- `src/pipeline/event-stage.ts`
- `tests/event-comparator.test.ts`

**Estimated Scope:** Medium

### Checkpoint: Events

- [x] Entity-enriched articles can create and attach to cyber events.
- [x] Multiple related articles can map to one cyber event through stronger similarity matching.
- [x] Duplicate articles do not create duplicate events beyond canonical URL dedup.
- [x] Ambiguous event grouping uses LLM only after cheap matching.

**Verification Completed:**
- `npm run check`
- `npx vitest run tests/event-grouper.test.ts`
- `env DATABASE_URL=postgres://cyber:cyber@localhost:5432/vendor_threat_watch npm run events:articles -- --limit=5`
- Local event run: 2 reviewed, 2 created, 2 attached.
- Added layered dedup coverage with `tests/dedup.test.ts`.

## Phase 7: LLM Enrichment and Alert Decisions

### Task 17: Implement Cyber Classification

**Status:** Completed. Cyber classification uses strict Zod schemas, injectable LLM callers for tests, article JSON persistence, and audit logging.

**Description:** Classify cyber relevance, vendor roles, affected products, severity, urgency, confidence, and reasoning with strict JSON output.

**Acceptance Criteria:**
- Classifier returns Zod-validated JSON.
- Vendor roles include affected, reporting, mitigating, researching, patching, unrelated, and unknown.
- Raw JSON is stored on the article.
- Important fields are also persisted to entities/events.

**Verification:**
- Tests cover valid output, invalid output, and low-confidence output.
- Classification is not called for cheap-filtered irrelevant articles.

**Dependencies:** Tasks 11, 15

**Files Likely Touched:**
- `src/llm/cyber-classifier.ts`
- `src/llm/schemas.ts`
- `src/pipeline/classification-stage.ts`
- `tests/cyber-classifier.test.ts`

**Estimated Scope:** Medium

### Task 18: Implement Event Summarization

**Status:** Completed. Event comparison and summarization wrappers use strict JSON schemas, and event summaries can be persisted with raw JSON.

**Description:** Generate and update event summaries from the primary article, material updates, affected vendors/products, CVEs, and attack types.

**Acceptance Criteria:**
- Event summaries are concise and audit-backed by source articles.
- Material updates can refresh summary, severity, urgency, and last seen time.
- Raw LLM summary JSON is stored.

**Verification:**
- Tests mock summarizer output and material update handling.

**Dependencies:** Tasks 16, 17

**Files Likely Touched:**
- `src/llm/summarizer.ts`
- `src/events/event-summary-builder.ts`
- `tests/event-summary.test.ts`

**Estimated Scope:** Medium

### Task 19: Implement Alert Decision and Suppression

**Status:** Completed. MVP database alert decisions exist, recent-alert suppression exists, and LLM classification output now records vendor roles for mention-only suppression inputs.

**Description:** Create database alert rows only for credible, vendor-impacting cyber events.

**Acceptance Criteria:**
- Alert requires cyber relevance, affected/patching vendor role, active inventory match, confidence threshold, medium-or-higher severity, P1/P2 urgency, and new/materially updated event.
- Alerts are suppressed when the same event was alerted within the configured suppression window.
- Suppression reason is stored.
- MVP output writes alerts to the database and console logs.

**Verification:**
- Tests cover alert, suppress duplicate, suppress mentioned-only vendor, suppress low confidence, and material update alert cases.

**Dependencies:** Tasks 17, 18

**Files Likely Touched:**
- `src/alerts/alert-decision.ts`
- `src/alerts/alert-suppression.ts`
- `src/alerts/alert-output.ts`
- `src/pipeline/alert-stage.ts`
- `tests/alert-decision.test.ts`

**Estimated Scope:** Medium

### Checkpoint: Alert MVP

- [x] Event-based alert rows are stored.
- [x] Duplicate alerts are suppressed by recent-alert window.
- [x] Mention-only vendors do not alert.
- [x] Console output shows alert and suppression reasons.

**Verification Completed:**
- `npm run check`
- `npx vitest run tests/llm-schemas.test.ts tests/llm-reasoning.test.ts`
- Added `llm_audit_logs` migration for classification/comparison/summary traceability.

**Verification Completed:**
- `npm run check`
- `npx vitest run tests/alert-decision.test.ts`
- `env DATABASE_URL=postgres://cyber:cyber@localhost:5432/vendor_threat_watch npm run alerts:events -- --limit=5`
- Local alert run: 2 reviewed, 0 sent, 2 suppressed.

## Phase 8: Pipeline Runner and Workers

### Task 20: Add Synchronous Pipeline Runner

**Status:** Completed. `pipeline:run` executes bounded ingest/filter/extract/entity/embed/dedup/event/event-embedding/classification/alert stages and can skip ingest or LLM calls.

**Description:** Wire the stage functions into a single local runner for deterministic end-to-end testing.

**Acceptance Criteria:**
- A command runs ingest through alert decision for a bounded number of articles.
- Each stage checks current status before processing.
- Pipeline can resume partially processed articles.

**Verification:**
- Manual run processes a small batch end to end.
- Logs show stage transitions for each article.

**Dependencies:** Tasks 7 through 19

**Files Likely Touched:**
- `src/pipeline/*.ts`
- `scripts/run-pipeline.ts`
- `src/index.ts`

**Estimated Scope:** Medium

### Task 21: Introduce BullMQ Queues

**Status:** Completed. BullMQ queue factories, retry defaults, worker entry point, and stage job processor are in place.

**Description:** Wrap existing stage functions in BullMQ queues and workers after the synchronous runner is stable.

**Acceptance Criteria:**
- Queues exist for ingest, extraction, detection, embedding, dedup, event, LLM, and alert stages.
- Workers load records from Postgres, check status, process one task, save result, and enqueue the next stage.
- Retry and dead-letter behavior is configured per stage.

**Verification:**
- Worker tests mock queue transitions.
- Manual run starts workers and processes seeded feed articles.

**Dependencies:** Task 20

**Files Likely Touched:**
- `src/queue/queue.ts`
- `src/queue/jobs.ts`
- `src/queue/workers/*.ts`
- `scripts/run-worker.ts`
- `tests/workers.test.ts`

**Estimated Scope:** Medium

### Checkpoint: Worker Pipeline

- [x] Synchronous runner still works.
- [x] Queue workers process the same stages.
- [x] Failed stages are retryable.
- [x] Article metadata is preserved on downstream failure.

**Verification Completed:**
- `npm run check`
- `npx vitest run tests/pipeline-runner.test.ts tests/workers.test.ts tests/queue-and-metrics.test.ts`

## Phase 9: Observability, Hardening, and Cleanup

### Task 22: Add Structured Logs and Basic Metrics

**Status:** Started. Basic in-memory metrics collector exists; structured pipeline logging remains partial.

**Description:** Standardize logs and counters for the major business and pipeline events.

**Acceptance Criteria:**
- Logs include feed fetched, article discovered, duplicate skipped, extraction success/failure, vendor detected, embedding generated, similar article/event found, classification completed, event created/updated, alert sent/suppressed.
- Metrics include fetched, created, deduped, extraction failed, Playwright used, LLM calls, events created/updated, alerts sent/suppressed, pipeline latency, and published-to-alert latency.

**Verification:**
- Manual run emits expected logs.
- Unit tests cover metric increment wrappers where useful.

**Dependencies:** Task 20

**Files Likely Touched:**
- `src/utils/logger.ts`
- `src/utils/metrics.ts`
- Pipeline stage files

**Estimated Scope:** Small

### Task 23: Harden Security and Compliance Boundaries

**Description:** Reduce accidental leakage and unsafe scraping behavior.

**Acceptance Criteria:**
- Secrets are not logged.
- Article content sent to LLM is bounded and sanitized.
- Playwright extractor does not handle authenticated scraping by default.
- Source rate-limit/concurrency settings are configurable.
- Internal vendor inventory sent to external LLMs is minimized.

**Verification:**
- Tests cover log redaction helpers.
- Manual review of prompt inputs confirms only required context is sent.

**Dependencies:** Tasks 10, 17, 21

**Files Likely Touched:**
- `src/utils/logger.ts`
- `src/llm/*.ts`
- `src/extraction/*.ts`
- `src/config/env.ts`

**Estimated Scope:** Small

### Task 24: Deprecate Qdrant MVP Path

**Description:** Once pgvector search is verified, remove Qdrant from the default MVP path or clearly mark it as optional future storage.

**Acceptance Criteria:**
- Main pipeline uses Postgres/pgvector only.
- README no longer tells users Qdrant is required for MVP vector search.
- Old Qdrant code is either removed or isolated behind an optional adapter.

**Verification:**
- `npm run check`
- `npm test`
- Manual pipeline run works with Qdrant stopped.

**Dependencies:** Tasks 13, 20

**Files Likely Touched:**
- `src/storage/qdrantStore.ts`
- `src/nodes/triageNodes.ts`
- `README.md`
- `docs/architecture.md`
- `package.json`

**Estimated Scope:** Medium

### Checkpoint: Production-Shaped MVP

- [ ] End-to-end local pipeline runs from RSS ingestion to alert output.
- [ ] Postgres stores all source articles, entities, events, classifications, embeddings, and alerts.
- [ ] Alerts are event-based and suppression works.
- [ ] Queue workers are retryable and status-aware.
- [ ] Tests cover the highest-risk deterministic modules.

## Suggested Implementation Order

1. Database foundation: Tasks 1-3.
2. Seed data and repositories: Tasks 4-5.
3. RSS ingestion and duplicate-safe storage: Tasks 6-7.
4. Cheap filtering and extraction: Tasks 8-10.
5. Entity detection and embeddings: Tasks 11-13.
6. Deduplication and event grouping: Tasks 14-16.
7. LLM classification, summaries, and alerts: Tasks 17-19.
8. Synchronous runner, then workers: Tasks 20-21.
9. Observability, hardening, and Qdrant cleanup: Tasks 22-24.

## Parallelization Opportunities

- Tasks 6 and 8 can be developed in parallel after the repository contracts are clear.
- HTTP extraction fixtures and detection tests can be written while database work is underway.
- Alert decision logic can be started with mocked event/classification inputs before LLM enrichment is complete.
- Documentation updates can happen alongside implementation, but schema and repository contracts should settle first.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| pgvector dimensions mismatch embedding model output | High | Detect dimensions early or lock embedding model/dimension in env and migration docs. |
| LLM cost grows with feed volume | High | Enforce cheap filters, duplicate checks, and candidate limits before LLM calls. |
| Vendor mentions create noisy alerts | High | Require vendor role classification and inventory match before alerting. |
| Playwright becomes slow or brittle | Medium | Use HTTP extraction first, limit Playwright concurrency, add timeouts and source rules. |
| Queue workers duplicate work on retry | Medium | Make every worker status-aware and idempotent. |
| RSS/feed extraction failures hide useful events | Medium | Preserve article metadata, store errors, and allow review/retry. |
| Big-bang storage migration breaks prototype flow | Medium | Add repositories and synchronous pipeline before replacing existing graph/node flow. |

## Open Questions

- Which embedding provider/model should be final for MVP: current MiniMax embeddings or OpenAI `text-embedding-3-small`?
- Should the migration use a fixed vector dimension or generate model-specific migrations?
- Do we want to keep Qdrant as an optional adapter after pgvector is live, or remove it from the project?
- What is the initial enterprise vendor inventory source: static seed file, CSV import, or future database/admin workflow?
- Should RSS ingestion fetch full articles from all feeds, or only after cheap title/summary filtering?
- Which alert threshold should be the MVP default: `confidence >= 0.75` and P1/P2 only, or include high-confidence P3 patch advisories?

## MVP Definition of Done

- RSS feeds are ingested into PostgreSQL without exact duplicates.
- Articles are extracted with HTTP first and Playwright fallback only when needed.
- Vendors, products, CVEs, IOCs, and attack indicators are detected and stored.
- Article and event embeddings are stored in pgvector.
- Similar articles/events can be retrieved semantically.
- Related articles are grouped into cyber events.
- LLM classification distinguishes affected vendors from reporting/researching/mitigating vendors.
- Alerts are created only for credible events affecting monitored vendors/products.
- Duplicate event alerts are suppressed.
- End-to-end local run emits structured logs and database alert rows.
