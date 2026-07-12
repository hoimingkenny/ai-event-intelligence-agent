# Plan: Embedding lifecycle redesign (ADR-0001)

Build the accepted decisions in [ADR-0001](../adr/0001-embedding-lifecycle.md). Do not implement centroid event vectors, semantic dedup wiring, or threshold recalibration in this plan.

## Success criteria

- [ ] Article and event vectors are written only through an embedding lifecycle module (stages are thin callers).
- [ ] Rows store `embedding_model`, `embedding_dims`, `embedded_at`.
- [ ] `findSimilarArticles` / `findSimilarEvents` filter to the current model; null provenance excluded.
- [ ] Event stage processes `EMBEDDED` only.
- [ ] On event create, `event_embedding` is copied from the creating article’s embedding (plus provenance).
- [ ] Deferred sweep retries missing/failed event embeddings with bounded retry (max 5).
- [ ] Explicit re-embed command exists for model changes (no boot-time wipe).
- [ ] Unit/integration tests cover the seams above.
- [ ] `npx tsx scripts/diagnose-same-event-grouping.ts` updated for event-vector=article-vector; run recorded. If still red, document as threshold follow-up—not a blocker to merge the lifecycle work if seams are correct.

## Work sequence

### 1. Schema + repository guards

- Migration: add provenance columns to `articles` and `cyber_events`.
- Extend `saveEmbedding` / `saveEventEmbedding` to write provenance from current env/model.
- Similarity queries: `WHERE embedding_model = $current AND embedding_dims = $currentDims` (and non-null vector).
- Backfill policy: leave old rows as null provenance (ineligible)—no mass clear.

### 2. Embedding lifecycle module

- Introduce one module (e.g. under `src/embedding/`) that owns:
  - provider call + truncate/dims
  - article embed → status `EMBEDDED` / `EMBEDDING_PENDING` + retry_count
  - event embed/copy on create
  - event missing-embedding sweep with the same retry policy
  - `reembedForModelChange()` (explicit operator path)
- Thin `embedding-stage` / `event-embedding-stage` to call into it (or fold event create-path into event stage via the module).

### 3. Event stage correctness

- Candidate query: `EMBEDDED` only (drop `ENTITY_EXTRACTED`).
- After create: call lifecycle to set event embedding from creating article vector.
- Keep later sweep for failures/backfill only.

### 4. Tests + diagnose harness

- Tests: provenance filter; unembedded not grouped; create copies article vector; retry bounds; model filter excludes null/other model.
- Update `scripts/diagnose-same-event-grouping.ts` so simulated events use the creating article vector (not template embed).
- Run against local Ollama config; capture output in the PR/code-review note.

### 5. Docs closeout

- Code review doc under `docs/code-reviews/` before merge to main.
- Point readers at ADR-0001 + this plan; note deferred centroid + thresholds.

## Explicit non-goals

- Recalibrating `0.15 / 0.35 / 0.18`
- Semantic dedup vector wiring
- Centroid-on-attach
- Changing cheap-filter / extraction / classification

## Suggested PR shape

Prefer one feature branch with the migration + lifecycle + event-stage change together (they are one calibrated correctness unit). Split only if the diff becomes unreviewable—then: (1) schema+guards, (2) lifecycle+stages, (3) diagnose/tests.
