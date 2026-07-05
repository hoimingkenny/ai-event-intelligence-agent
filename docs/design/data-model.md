# Data Model

This project separates source documents from real-world cyber events.

## Core Tables

### `feeds`

Configured RSS sources with source metadata, trust level, active state, and last fetch timestamp.

### `articles`

Raw source-document registry. Articles keep canonical URL data, hashes, RSS summary, extracted text, extraction status, processing status, article embedding, and raw LLM classification JSON.

Quality columns written at extraction time: `content_quality_score` (length × boilerplate-density penalty) and `rss_recall` (word recall of the RSS summary against extracted text — free ground truth; `null` for rss-only extractions so the metric cannot grade itself). These drive per-source drift detection.

`processing_status` is the pipeline state machine: `NEW → EXTRACTION_PENDING → EXTRACTION_SUCCESS → ENTITY_EXTRACTED → EMBEDDED → GROUPED → CLASSIFIED`, with terminal/side states `IGNORED`, `DUPLICATE`, `EXTRACTION_FAILED`. Work queues read newest-published first.

### `article_entities`

Structured entities extracted from articles. The MVP stores vendors, products, CVEs, IOCs, and attack types. Entity rows are separate from article text so grouping, search, and review can use structured signals.

### `cyber_events`

Canonical event records. Events aggregate related articles and track title, summary, status, severity, urgency, confidence, affected vendors/products, CVEs, attack types, source count, event embedding, and LLM summary JSON.

`grouping_key` is the canonical dedup key (CVE-first, normalized vendor/product/attack fallback), indexed on open events — the first, free rung of the grouping ladder. `severity`/`urgency`/`confidence` are computed by classification rollup (never-downgrade semantics, corroboration bonus per source), not hardcoded at creation.

### `event_articles`

Lineage table connecting source articles to canonical cyber events. It records relationship, confidence, primary-source status, and whether the article is a material update.

### `alerts`

Event-level notification decisions. Alerts store channel, reason, severity, urgency, suppression state, suppression reason, and sent timestamp.

`alert_tier` distinguishes `early_warning` (fresh, labeled unconfirmed) from `confirmed` (strict gate). The latest non-suppressed alert per event drives suppression, upgrade (`early_warning → confirmed`), and material-update bypass decisions; `(event_id, created_at DESC)` is indexed for that lookup. Publication→alert latency is computed from alerts joined to their events' earliest `published_at`.

### `llm_audit_logs`

Traceability table for schema-validated LLM calls. Each audit record links a task to an article or event, model, prompt version, request payload, response payload, validation status, and error details.

### `evaluation_runs`

Quality measurement table. Each run stores duplicate reduction, grouping precision, classification precision, false-positive rate, LLM call reduction, extraction success, source-to-alert latency, and the full metrics JSON.

## Naming Notes

The original generic plan uses `events` and `notifications`. This cyber-focused implementation uses `cyber_events` and `alerts` to make the domain explicit. The behavior is equivalent: events are canonical real-world incidents, and alerts are event-level notification records.
