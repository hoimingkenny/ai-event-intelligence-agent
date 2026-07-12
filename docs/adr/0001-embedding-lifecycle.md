---
status: accepted
---

# Embedding lifecycle owns article and event vectors

Event grouping was splitting same-incident articles because embedding concerns were scattered (config, client, two stages, repos), similarity compared anonymous vectors with no model guard, the event stage grouped articles without embeddings, and new events were embedded only in a later stage—so same-run articles could not attach by distance. We decided to deepen a single **embedding lifecycle** module that owns both **article embeddings** and **event embeddings**, including truncate/dims, provenance writes, bounded retry, and status transitions.

**In scope:** lifecycle ownership of both surfaces; persist `embedding_model`, `embedding_dims`, and `embedded_at`; similarity queries filter to the current model (null provenance ineligible); event stage only considers **EMBEDDED** articles; on canonical-event create, set **event embedding = creating article embedding**, then keep a later sweep for retries/backfill; bounded retry (e.g. max 5); explicit re-embed command for model changes (no silent wipe on boot).

**Out of scope (follow-ups):** wiring semantic article deduplication; incremental centroid event vectors; model-scoped distance threshold registry. Hash/title article deduplication stays as-is. LLM remains only for the uncertain grouping band and summaries—not for manufacturing vectors.

**Acceptance:** unit/integration tests for the seams above, plus the SailPoint same-event diagnose loop updated for “event vector = article vector.” A remaining red loop after that may indicate threshold calibration, not a failed lifecycle redesign.

## Considered options

- **Lifecycle for articles only** — rejected; leaves event embed retry/provenance asymmetric.
- **Auto-wipe mismatched vectors on startup** — rejected; too destructive for POC iteration; filter + explicit re-embed is enough for safety.
- **Template text for event embeddings** — rejected for grouping; article/event text-shape mismatch inflated distances (observed on SailPoint cluster).
- **LLM→JSON then embed for events** — rejected; costly vs 2h SLO; entities and LLM comparator already cover structured/ambiguous cases.
- **Wire semantic dedup in this change** — deferred; overlaps grouping and is unsafe while thresholds are uncalibrated.
