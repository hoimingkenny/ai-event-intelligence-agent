# Data Model

This project separates source documents from real-world cyber events.

## Core Tables

### `feeds`

Configured RSS sources with source metadata, trust level, active state, and last fetch timestamp.

### `articles`

Raw source-document registry. Articles keep canonical URL data, hashes, RSS summary, extracted text, extraction status, processing status, article embedding, and raw LLM classification JSON.

### `article_entities`

Structured entities extracted from articles. The MVP stores vendors, products, CVEs, IOCs, and attack types. Entity rows are separate from article text so grouping, search, and review can use structured signals.

### `cyber_events`

Canonical event records. Events aggregate related articles and track title, summary, status, severity, urgency, confidence, affected vendors/products, CVEs, attack types, source count, event embedding, and LLM summary JSON.

### `event_articles`

Lineage table connecting source articles to canonical cyber events. It records relationship, confidence, primary-source status, and whether the article is a material update.

### `alerts`

Event-level notification decisions. Alerts store channel, reason, severity, urgency, suppression state, suppression reason, and sent timestamp.

### `llm_audit_logs`

Traceability table for schema-validated LLM calls. Each audit record links a task to an article or event, model, prompt version, request payload, response payload, validation status, and error details.

### `evaluation_runs`

Quality measurement table. Each run stores duplicate reduction, grouping precision, classification precision, false-positive rate, LLM call reduction, extraction success, source-to-alert latency, and the full metrics JSON.

## Naming Notes

The original generic plan uses `events` and `notifications`. This cyber-focused implementation uses `cyber_events` and `alerts` to make the domain explicit. The behavior is equivalent: events are canonical real-world incidents, and alerts are event-level notification records.
