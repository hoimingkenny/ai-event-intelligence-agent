# Code Review: Ollama embeddings + 1536-dim migration

- **Branch:** `feat/ollama-embeddings` → `main`
- **Commits:** `70fd798..HEAD` (includes prior branch work: plan archive, Codex/Cursor skills mirror, then embedding commits)
- **Date:** 2026-07-12
- **Reviewer:** Cursor Grok

## Summary of change

Adds a local Ollama embedding provider (`EMBEDDING_PROVIDER=ollama`) with Matryoshka truncate-then-renormalize to `EMBEDDING_DIMENSIONS`, defaults/examples at 1536 for pgvector HNSW (≤2000), and migration `015` that clears incompatible prior-model vectors, alters `articles.embedding` / `cyber_events.event_embedding` to `vector(1536)`, and restores cosine HNSW indexes. Documents model/threshold calibration invariants in `docs/engineering-notes/embedding-model-selection.md`. Also lands agent wayfinding (`docs/agents/*`, `CLAUDE.md`) and earlier-on-branch skills/plan-archive commits.

## Behaviour changes

- New env: `OLLAMA_BASE_URL`, `OLLAMA_EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` (falls back to `PGVECTOR_DIMENSIONS`, else 2048).
- `.env.example` sets `PGVECTOR_DIMENSIONS=1536` (was 2048).
- OpenRouter embed requests now pass `dimensions: env.embeddingDimensions`.
- All providers’ vectors are truncated/renormalized if longer than configured dimensions.
- Migration 015 nulls existing embeddings and rewinds `EMBEDDED` articles to `ENTITY_EXTRACTED` so embed stages regenerate; operators must run `db:migrate` and re-embed before semantic dedup/grouping are meaningful again.
- Default provider remains `minimax` unless `EMBEDDING_PROVIDER` is set.

## Risks and concerns

- **Vector-space break:** Old 2048-dim / other-model vectors cannot be compared with new ones. Mitigation: migration clears them; pipeline must re-embed. Accept temporary loss of semantic rungs until backfill completes.
- **Thresholds not recalibrated:** Dedup/grouping distance bands (`0.18` / `0.15` / `0.35`) are still prior-model constants. Accepted for POC with follow-up labeled pair eval (see engineering note).
- **Ollama `dimensions` may be ignored:** Client-side truncate/renorm covers Matryoshka-valid models; non-MRL models would silently lose quality if truncated. Current target (`qwen3-embedding`) is MRL-capable.
- **Live smoke flake:** `tests/agents.test.ts` live embed call timed out against configured OpenRouter (60s). Not treated as a code defect; unit provider tests cover the new paths.

## Test evidence

- `npm run check` passed.
- `npm test -- --run tests/embeddings-provider.test.ts` → 5 passed (OpenRouter + Ollama + truncate + errors).
- Full `npm test` with network: **201 passed**, 4 skipped, **1 failed** (live Embeddings client smoke timed out on OpenRouter; rate-limit path exists but hang is not handled).

## Follow-ups

- Recalibrate embedding distance thresholds on a labeled same-event / different-event pair set after choosing the production model.
- Harden or skip-on-timeout the live embed smoke so CI/local gates do not depend on provider latency.
- Ensure local `.env` `EMBEDDING_DIMENSIONS` / `PGVECTOR_DIMENSIONS` stay aligned after migrate.

## Verdict

**Approve-with-notes** — provider + migration + docs are coherent and unit-tested; merge is gated on operators running migration 015 and accepting uncorrected distance thresholds plus one flaky live OpenRouter smoke.
