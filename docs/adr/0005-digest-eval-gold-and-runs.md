---
status: accepted
---

# Digest eval: Postgres gold, Workspace UI, offline regen runs

We need to measure LLM article-digest / prompt quality on live ingest without a 500-article hunt. Ground truth is **human digest gold** (~50 stratified `DIGESTED` articles) stored in **Postgres**, with article text and monitored inventory **frozen at label time**. Labeling and reports live in **Workspace** (eval queue + article page), not the legacy review-dashboard eval panes.

**Gate metrics** come only from gold vs predictions: relatedness F1; vendor/product/CVE exact-match rate and set-F1. Soft warns (not CI failure) apply only when gold count ≥ 40. Baseline scores the stored `llm_article_digest`; prompt experiments write **offline eval-run predictions** (prompt version keyed) and never overwrite production digests unless a separate pipeline re-digest is run. An LLM **label assist** (pre-fill from stored digest + optional second opinion) and an on-demand **agreement report** are diagnostic only and never write gold.

## Considered options

- **Deterministic `article_entities` as gold** — rejected: ADR 0004 treats entities and digest as independent layers.
- **JSONL gold like cheap-filter** — rejected for Workspace-first labeling (filesystem coupling); report artifacts may still land under `eval/reports/`.
- **LLM-judge as gate metrics / scale proxy** — rejected: circular for prompt quality; judge stays assist + agreement only.
- **Overwrite production digest on prompt regen** — rejected: loses baseline and conflates eval with pipeline state.
