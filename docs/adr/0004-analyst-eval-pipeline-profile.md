---
status: accepted
---

# Analyst-eval pipeline profile: advisory filter + per-article LLM digest

Auto event clustering is producing incorrect groupings. The likely cause is noisy embed input (`title + rssSummary + cleanText` concatenated) while LLM signal extraction runs too late (`GROUPED` articles only). Cheap-filter calibration also needs more time than the PoC schedule allows.

We decided to add a **`analyst-eval` pipeline profile** (default for scheduled runs during this phase) that optimizes for **analyst comparison**, not automatic incident formation:

1. **Cheap filter becomes advisory-only** — still writes `cheap_filter_*` fields, but never blocks downstream work with `IGNORED`.
2. **Per-article LLM digest runs after extraction** — structured signal extraction stored in a new `articles.llm_article_digest` column.
3. **Automatic clustering is paused** in this profile — no article embeddings, dedup, event grouping, event classification, event summaries, or alerts.
4. **Analysts group incidents manually** in Workspace (existing create/approve flow).

The **`full` profile** keeps the current end-to-end pipeline for when digest-based embeddings and clustering thresholds are ready.

## Pipeline profiles

### `analyst-eval` (default during PoC evaluation)

```text
ingest
  → cheap filter (advisory)
  → extract
  → entities
  → llm_article_digest
  → STOP
```

### `full` (deferred re-enable)

```text
ingest
  → cheap filter (may gate — see follow-up)
  → extract
  → entities
  → llm_article_digest
  → article embeddings
  → dedup
  → events (grouping ladder)
  → event embeddings
  → classification
  → summary
  → alerts
```

Profile selection is explicit in code (`runPipeline({ profile: 'analyst-eval' | 'full' })`). Stage implementations remain in the repo; the runner skips edges/nodes per profile so re-enabling `full` does not require rewriting deleted stages.

## Cheap filter (advisory-only in `analyst-eval`)

**Behavior:**

- Run on every `NEW` article as today (RSS metadata signals, inventory match, layered cascade).
- Persist `cheap_filter_decision`, score, reasons, blocking reasons, and `cheap_filter_matched_signals`.
- **Do not** set `processing_status = 'IGNORED'`.
- Route every ingested article to extraction:
  - `KEEP` → `EXTRACTION_PENDING`
  - `MAYBE_KEEP` → `EXTRACTION_PENDING_LOW_PRIORITY`
  - `DROP` → same as above (advisory label only; the DROP decision remains visible for analyst review)

**Rationale:** `IGNORED` today prevents extraction (`listExtractionCandidates` only picks pending statuses). Advisory-only comparison requires all articles to reach extraction and LLM digest so analysts can judge false negatives on `/workspace/articles/[id]`.

**Filter re-queue:** Existing re-queue for historical `IGNORED` rows may remain for legacy data; new ingest in `analyst-eval` should not create more `IGNORED` rows.

## LLM article digest

**When:** After successful extraction (and entity extraction in pipeline order).

**In-flight status:** Claim sets `processing_status = 'DIGESTING'` before the LLM call. Success in `analyst-eval` → `DIGESTED`; success in `full` → back to `ENTITY_EXTRACTED` for embeddings. Failure reverts to `ENTITY_EXTRACTED`. Candidates include both `ENTITY_EXTRACTED` and `DIGESTING` with null digest so crashed claims are retried.

**Input:** Article record text — `title`, `sourceName`, `rssSummary`, `cleanText` (same payload as `classifyCyberArticle` today). **No** `article_entities` rows in the prompt.

**Output schema:** Reuse existing `CyberClassificationSchema` / `classifyCyberArticle` (`eventType`, `vendorRoles`, `affectedProducts`, `cves`, `severity`, `urgency`, `confidence`, `reasoning`, etc.).

**Storage:** New `articles.llm_article_digest JSONB` column. Separate from `articles.llm_classification`, which remains reserved for the post-grouping event-assessment path in `full` profile.

**Independence from entities:** Deterministic entity extraction and LLM digest are parallel signal layers for analyst comparison. No entity→LLM prompt injection and no post-digest entity reconciliation in `analyst-eval`.

**Inventory-aware digest (v2):** Digest uses a dedicated prompt/schema (`article-digest-v2`), not `CyberClassificationSchema`. The prompt receives the live active monitored inventory (`vendor`, `product`, `aliases`) as a closed list for `matchedVendors` / `matchedProducts`. Open-world fields `mentionedVendors`, `mentionedProducts`, and `affectedOrganizations` always capture who the article talks about so analysts can judge false negatives. Output also includes `relatedToMonitoredInventory`, `incidentSummary`, `cves`, `confidence`, `reasoning`. Relevance definition B: vulnerability / incident / attack / product advisory related to inventory (exploitation not required). When unrelated, `matched*` are empty but summary/CVEs/open-world actors remain. Matches are post-filtered to inventory names. Old digest JSON rows are left as-is.

**Audit:** Log LLM calls to `llm_audit_logs` with a distinct `task_name` (e.g. `article_digest`).

## Workspace UI

On `/workspace/articles/[id]`, show three comparable signal blocks:

| Block | Source |
|---|---|
| Filter signals | `cheap_filter_matched_signals` / decision fields |
| Extracted entities | `article_entities` |
| **LLM digest (post-extraction)** | `llm_article_digest` (new section) |

Keep the existing **LLM classification** section wired to `llm_classification` for `full` profile / legacy rows. Do not conflate digest and classification in one UI block.

Article peek may later surface a compact digest; not required for the first implementation slice.

## Paused stages in `analyst-eval`

Skipped entirely (runner orchestration, not deleted code):

- `article_embeddings`
- `dedup_stage`
- `events_stage`
- `event_embeddings`
- `classification_stage`
- `summary_stage`
- `alerts_stage`

**Rationale:** Embeddings and dedup exist primarily to feed auto-grouping. Running them without trustworthy clustering adds cost and confusing machine state. Alerts assume grouped events.

## Re-enabling `full` (follow-up, not this change)

When clustering quality is acceptable:

1. Switch default profile to `full` (or env override in deployment).
2. Change embed input to prefer **LLM digest text** over raw `cleanText` concatenation (see `buildArticleEmbeddingText`).
3. Re-tune embedding distance thresholds on labelled grouping pairs.
4. Optionally restore cheap-filter gating (`IGNORED`) in `full` only.

## In scope (implementation)

- Migration: `articles.llm_article_digest JSONB`
- `ArticleRepository.saveArticleDigest()` (or equivalent)
- New `runArticleDigestStage` (or extend pipeline with digest node)
- `buildPipelineGraph` profile parameter; `analyst-eval` as default in scheduler / `pipeline:run`
- Advisory-only changes in `runCheapFilterStage` when profile is `analyst-eval`
- Workspace article page: new LLM digest section + `getWorkspaceArticle` loads digest
- Tests: profile routing, advisory filter never sets `IGNORED`, digest stage persistence

## Out of scope

- Backfilling `llm_article_digest` for all historical articles (may be a one-off script later)
- Changing embedding model or grouping thresholds
- Gating alerts on publication status
- Replacing manual Workspace event creation
- Cheap-filter eval dataset growth / calibration work

## Considered options

- **Keep cheap filter as gate, run LLM digest only on KEEP/MAYBE_KEEP** — rejected; hides false negatives from analysts during calibration.
- **LLM digest on RSS only (before extraction)** — rejected; vendor/CVE/event-type signals need body text.
- **Reuse `llm_classification` column for digest** — rejected; couples per-article digest with post-grouping event rollup semantics.
- **Keep auto-clustering running with low trust** — rejected; bad groups pollute triage and undermine analyst trust.
- **Pause by deleting graph nodes** — rejected; brittle; profile-based skip preserves maintainability.
- **Feed `article_entities` into digest prompt** — rejected for `analyst-eval`; would contaminate side-by-side comparison. May revisit in `full`.
- **Env flag only (`PIPELINE_AUTO_CLUSTERING_ENABLED`)** — rejected in favor of explicit `analyst-eval` / `full` profiles for testability and documentation.

## Acceptance

- Scheduled pipeline runs in `analyst-eval` by default.
- Every newly ingested article reaches extraction and receives `llm_article_digest` when LLM is configured.
- `cheap_filter_decision = DROP` articles are still extractable and digestible; DROP visible on article page.
- No new `IGNORED` rows from ingest in `analyst-eval`.
- `/workspace/articles/[id]` shows filter signals, entities, and LLM digest side by side.
- `full` profile still runs the existing clustering path when explicitly selected (regression-tested).
