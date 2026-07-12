# Embedding Models Are Calibrated Instruments, Not Swappable Parts

This note records how the event-grouping pipeline's embedding layer degraded through a sequence of individually reasonable decisions, what an embedding model actually contributes to this system, and the selection criteria + invariants that prevent a repeat. The core lesson: an embedding model is not an interchangeable component behind an interface — every distance threshold, index, and text template in the system is implicitly calibrated to one specific model, and swapping the model without re-deriving those is a silent correctness change.

## 1. What embeddings do in this system

An embedding model maps text to a vector such that semantic similarity becomes geometric closeness (cosine distance). This system uses that geometry in exactly two places, both as *cheap similarity rungs* below an LLM:

- **Article dedup** (`src/dedup/article-dedup.ts`): nearest stored articles within 14 days, `distance <= 0.18` flags a semantic near-duplicate candidate.
- **Event grouping rung 2** (`src/events/grouping-decision.ts`): a new article's vector is searched against open events' vectors; `distance <= 0.15` attaches without an LLM call, `(0.15, 0.35]` escalates to the LLM comparator, `> 0.35` creates a new event.

Two properties follow immediately and are easy to forget:

1. **Distances are only meaningful within one model's vector space.** Article vectors and event vectors are compared directly, so both *must* come from the same model, same version, forever — or be wholly re-embedded together.
2. **The thresholds are not system constants; they are model constants.** `0.15 / 0.35 / 0.18` describe where "same event" and "different event" sit in one particular model's distance distribution. A different model has a different distribution, and the numbers become arbitrary.

## 2. The failure chain

Each step was locally sensible; the composition broke event grouping (same-event articles splitting into separate events):

1. **The MiniMax coding-plan key cannot call embeddings.** `sk-cp-` subscription keys are scoped to M-series chat models via the OpenAI/Anthropic-compatible endpoints. `embo-01` embeddings are a pay-as-you-go platform feature on a separate key system. Embedding calls failed with the configured key.
2. **The workaround was a free OpenRouter model** (`nvidia/llama-nemotron-embed-vl-1b-v2:free`, migration `010_openrouter_2048_embeddings.sql`). Three problems rode in unexamined:
   - **Wrong task shape.** It is an *asymmetric* vision-language retrieval model (instruction-prefixed query vs document). Our task is *symmetric* text similarity (news text vs news text). Used symmetrically with no instructions, its same-event distances do not respect our bands — plausibly pushing nearly everything past the 0.35 "confidently different" cutoff, which starves the LLM comparator and defaults every article to `create new event`.
   - **2048 dimensions exceeds pgvector's HNSW limit (2000)**, so the migration had to drop both ANN indexes. Survivable at POC volume via sequential scan; a scaling cliff later.
   - **`:free`-tier rate limits** feed batch failures into the pipeline, and the event stage would then group `ENTITY_EXTRACTED` leftovers *without a vector* — rung 2 skipped entirely, new event guaranteed unless the exact grouping key matched.
3. **The thresholds were never recalibrated** across the swap. The attach/uncertain bands still encode the previous model's geometry.

A fourth, model-independent defect compounds it: **the two sides of the comparison embed different text shapes.** Articles embed `title + rssSummary + up to 12,000 chars of body`; events embed a short mechanical template (draft title, first 500 chars of the *first* article, `Severity:/Vendors:/CVEs:` lines) — computed once, never refreshed after the LLM summary rewrites the event or new sources attach. Same model or not, long-prose-vs-short-template pairs sit systematically farther apart than prose-vs-prose pairs, inflating every distance rung 2 sees.

## 3. How to choose an embedding model (criteria in priority order)

1. **Task shape first: symmetric vs asymmetric.** Retrieval models (short query → long document, often instruction-prefixed) and similarity models (like-vs-like) are trained differently. This system needs symmetric similarity. General-purpose text embedders (`text-embedding-3-*`, Gemini embeddings, Qwen3-Embedding) do this by default; anything marketed as a "retriever," and anything multimodal, needs explicit justification.
2. **Context window ≥ embedded text length** (~3,000 tokens at our 12k-char cap), or the model silently truncates.
3. **Dimensions ≤ 2000** — hard pgvector HNSW constraint — or Matryoshka (MRL) support so vectors can be truncated to a compliant size.
4. **Benchmarks as a coarse filter only.** MTEB eliminates bad models; it cannot rank decent ones *for this corpus*. Read the STS/clustering columns, not the headline score.
5. **A ~50-pair labeled eval on our own data beats every leaderboard.** Hand-label same-event / different-event article pairs from the DB (the cheap-filter eval workflow already models this); the model whose distance distributions separate most cleanly wins, and the gap between the distributions *is* the calibrated threshold. This converts both model choice and threshold choice from priors into measurements.
6. **Operational boredom:** paid tier over rate-limited free tiers; a provider unlikely to deprecate the model soon; one model for every surface whose vectors are ever compared.

Explicitly *not* decision criteria at this scale: price (article + event embedding at current volume ≈ $0.02–0.05/month on `text-embedding-3-small`; even 20× inventory growth stays under $0.50/month), multilingual/multimodal capability, latency.

## 4. Decision

**Adopted: `qwen/qwen3-embedding-8b` via the existing OpenRouter key, truncated to 1536 dims** (migration `015_qwen3_1536_embeddings.sql`). Qwen3-Embedding-8B is symmetric-capable, tops MTEB among affordable options (~$0.01/1M via OpenRouter), has a 32k context, and is Matryoshka-trained — its native 4096 dims are requested at/truncated to 1536 with renormalization (`src/config/embeddings.ts`), which restores pgvector HNSW. The client enforces the target dimension even if the provider ignores the `dimensions` request parameter. Fallback candidate if the labeled eval shows weakness on security-news pairs: `openai/text-embedding-3-small` (1536 native) — decided by the eval, not by leaderboard position.

Adopting it is a coupled migration, not a config flip:

1. Wipe vectors, retype columns to `vector(1536)`, recreate the HNSW indexes (reverse of migration 010).
2. Re-embed articles and events with the new model.
3. Re-derive `EMBEDDING_ATTACH_DISTANCE` / `EMBEDDING_UNCERTAIN_DISTANCE` / the dedup threshold from observed distances on labeled pairs.

Planned alongside (separately justified): event vector = incremental centroid of member-article vectors, which removes the prose-vs-template mismatch, the one-shot staleness, and the event-embedding API call in a single change.

## 5. Why 1536 dimensions, not the native 4096

Dimension count is the least important quality variable in this stack, and the only one with a hard infrastructure penalty — so it is chosen for the database, not for the leaderboard.

- **The index constraint is binary.** pgvector builds HNSW only up to 2,000 dims on `vector` columns (`halfvec` extends to 4,000 — still short of 4096). Above the cap, every dedup and grouping query — run for every article, every cycle — is a sequential scan computing full-width distances per row. Migration 010 (2048 dims) already paid this price once.
- **The quality curve is flat up there.** Embedding quality comes from the model's training and size, not its output width. Matryoshka training *concentrates* signal in the leading dimensions by design; truncating Qwen3-8B 4096 → 1536 costs on the order of ~1 benchmark point. The trade is ~99% of the signal with HNSW versus 100% without it.
- **Width has linear costs and a mild statistical tax.** 4096 float32 dims = 16 KB/vector vs 6 KB at 1536 (2.7× storage, memory, and arithmetic per comparison). High-dimensional distance concentration also slightly compresses the same-event/different-event gap that the grouping thresholds depend on.
- **Dims fix none of our actual failures.** The event-splitting causes were model shape, uncalibrated thresholds, text-shape mismatch, and unembedded articles — all orthogonal to width.

The choice is testable, not doctrinal: the labeled-pair eval can compare `EMBEDDING_DIMENSIONS=1536` vs 2000 (the index ceiling) on distance separation. If a future model genuinely needed more width, the escape hatches are `halfvec`, binary-quantized expression indexes, or a dedicated vector store — none worth their complexity at this scale.

## 6. Invariants going forward

- **One model per comparison space.** Any two vectors whose distance is ever computed must come from the same model + version. Enforce with provenance columns (`embedding_model`, dims) and filter similarity queries by current model.
- **Thresholds are scoped to a model.** A model change without threshold recalibration is a correctness bug, not a tuning omission. The migration that changes the model must be the change that recalibrates.
- **Never rank candidates for an article that has no vector.** Grouping an unembedded article means rung 2 silently vanishes; park it for the next cycle instead.
- **Embed comparable text shapes on both sides** of any distance check.
- **Stay ≤ 2000 dims** (or MRL-truncate) so ANN indexing remains available.

## 7. Transferable lesson

When a component's output feeds numeric decision rules, the component and the rules form one calibrated unit. Swapping the component "behind the interface" — same types, same API — while keeping the rules is the most dangerous kind of change, because nothing fails loudly: the pipeline runs, vectors flow, and only the *decisions* quietly go wrong. Treat model + thresholds + index + text template as a single versioned artifact, and make the eval set the thing that authorizes changing any of them.

## File index

| File | Role |
|---|---|
| `src/config/embeddings.ts` | Provider clients (MiniMax non-standard endpoint, OpenRouter) |
| `src/embedding/embedding-client.ts` | Embedding text templates for articles and events |
| `src/pipeline/embedding-stage.ts` | Article embedding stage (batching, failure parking) |
| `src/pipeline/event-embedding-stage.ts` | One-shot event embedding stage |
| `src/events/grouping-decision.ts` | Distance thresholds + grouping ladder decision logic |
| `src/dedup/article-dedup.ts` | Semantic near-duplicate band (0.18 / 14 days) |
| `src/db/migrations/010_openrouter_2048_embeddings.sql` | The uncalibrated model swap this note is about |
