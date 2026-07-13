# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, and others) when working with code in this repository. It is the canonical agent-guidance file; CLAUDE.md imports it.

## Project Overview

Vendor Threat Watch is an AI-assisted cyber early-warning and vendor-impact triage agent. It identifies fresh cyber events, maps them to monitored vendor products, deduplicates related reports into canonical events, and surfaces items requiring review within a 2-hour incident response window.

**LLM is not the system of record** — it performs specialist reasoning inside a deterministic workflow. Postgres is the source of truth; every stage is independently retryable and auditable.

**Current scope: proof of concept.** The monitored inventory (`src/storage/vendorInventory.ts`) is deliberately narrowed to 3 vendor products — CyberArk PAS (quiet, critical), Zscaler ZIA (mid-volume), Microsoft Windows Server/Exchange/Entra (high-volume, noisy) — with source-tier-diverse feeds in `src/config/rssFeeds.ts` (CISA, MSRC, CyberArk blog, security media). The cheap-filter eval dataset targets the same 3 products. Expand the inventory only after the evaluation gate is trustworthy at this scope.

## Development Workflow (mandatory)

1. **Never commit directly to `main`/`master`.** All changes go on a feature branch (`feat/…`, `fix/…`, `chore/…`, `docs/…`).
2. **Before merging to `main`, write a code review document** in `docs/code-reviews/` (copy `docs/code-reviews/TEMPLATE.md`, name it `YYYY-MM-DD-<topic>.md`). Audience: senior developer. It must cover what changed and why, risks/behaviour changes, test evidence, and an explicit verdict. The review commit belongs on the same branch as the change.
3. Merge only after `npm run check` and `npm test` pass.

## Commands

```bash
npm install              # Install dependencies
cp .env.example .env     # Configure environment (MINIMAX_API_KEY for LLM; OPENROUTER_API_KEY or Ollama for embeddings)
docker compose up -d     # Postgres (pgvector) + Redis
npm run db:migrate       # Apply SQL migrations (src/db/migrations/)
npm run db:seed          # Seed feeds + monitored vendors

npm run pipeline:run     # Full pipeline once (advisory-locked): ingest → filter →
                         #   extract → entities → embed → dedup → events → classify → alerts
npm run scheduler        # Internal loop: full pipeline every RSS_FETCH_INTERVAL_MINUTES
npm run worker           # BullMQ worker mode (needs Redis)
npm run drift:check      # Per-source extraction quality report (exit 2 on drift)
npm run latency:check    # Publication→alert p50/p90 vs 2h SLO (exit 2 on violation)
npm run portal           # Public Events/Articles catalogue (:4322; approved-only)
npm run review:dashboard # Human review dashboard with verdict capture (:4321)

npm run fixtures:fetch -- <url>   # Save real article HTML as extraction fixture
npm run fixtures:review           # Side-by-side extraction review report (review/)

npm run check            # Type-check TypeScript
npm test                 # Run test suite (vitest)
npm run eval             # Run labelled evaluation set

npm run eval:cheap-filter   # Cheap-filter eval against labelled dataset (reports in eval/reports/)
npm run eval:candidates     # Harvest labeling candidates from pipeline DB into eval/datasets/
npm run articles:manual     # Import hand-authored test articles (eval/datasets/manual-articles.jsonl) into the DB + filter them
npm run eval:review         # Labeling + report review UI for the cheap-filter dataset (:4323)
npm run eval:validate       # Validate cheap-filter dataset JSONL and print label counts
```

Individual stage commands also exist (`ingest:rss`, `filter:articles`, `extract:articles`, `entities:articles`, `embed:articles`, `dedup:articles`, `events:articles`, `classify:articles`, `alerts:events`).

Note: `npm run dev` runs the legacy in-memory scaffold (`src/graph.ts`), not the real pipeline.

## Architecture

```text
src/pipeline/             # Stage functions + runner (the real system)
  runner.ts               # LangGraph StateGraph orchestrator; watchdog nodes for
                          #   drift (post-extraction) and latency (post-alerts)
  ingest-stage.ts …       # One file per stage; state machine via articles.processing_status
src/extraction/           # Article content extraction
  readable-content.ts     # Layered cleaning: per-source selectors → DOM pruning +
                          #   Readability → boilerplate filter; native-ad cluster removal
  extraction-router.ts    # RSS-summary → HTTP; Playwright after HTTP 403/429
src/detection/            # Deterministic entity/CVE/vendor/keyword extractors
src/dedup/                # Hash / title / semantic dedup decisions
src/events/               # Article → event draft grouping
src/llm/                  # MiniMax reasoning: classifier, event comparator, summarizer
src/monitoring/           # extraction-drift.ts: per-source rolling quality watchdog
src/evaluation/           # Labelled dataset evaluation
src/db/                   # Postgres pool, SQL migrations, repositories
src/queue/                # BullMQ queues + pipeline worker
src/utils/word-overlap.ts # Word-level recall/precision (extraction ground truth)
src/config/               # env, MiniMax LLM + OpenRouter/Ollama embeddings clients, RSS feed list
src/types/domain.ts       # Core domain types
docs/                     # plans/ | design/ | engineering-notes/ | code-reviews/ (see docs/README.md)
```

Legacy scaffold kept for reference: `src/graph.ts`, `src/nodes/`, `src/agents/`, `src/storage/` (in-memory + Qdrant era; superseded by the Postgres/pgvector pipeline).

## Two Operating Modes

**Early-Warning Mode**: Speed and freshness priority. Accepts low-confidence signals but labels them clearly. Triggered by prompts like "Find latest cyber attack news today."

**Confirmed Intelligence Mode**: Source confidence and confirmation priority. Triggered by prompts like "Summarise confirmed cyber incidents this week."

## Deduplication Result Types

`same_article_duplicate` → `same_event_no_new_information` → `same_event_new_source` → `same_event_material_update` → `related_but_separate_event` → `separate_event` → `uncertain_need_human_review`

## Extraction Quality (invariants)

- `articles.rss_recall` is written at extraction time (word recall of RSS summary vs cleanText); `null` for `rss_only` extractions — do not "fix" that, it prevents the metric from gaming itself.
- Drift detection (`src/monitoring/extraction-drift.ts`) uses rolling medians per source; thresholds live in `DEFAULT_DRIFT_THRESHOLDS`.
- Ad-cluster removal in `readable-content.ts` is structure-based (repeated offsite campaign links), deliberately not class-name-based. Its false-removal guardrails (span/char limits, same-site exemption) have dedicated tests — keep them passing.
- linkedom requires a complete `<html><body>…` document; bare fragments silently lose content.

## Current State

Done: Postgres/pgvector pipeline with per-stage state machine; LangGraph StateGraph runner; MiniMax LLM + OpenRouter/Ollama embeddings; Readability-based extraction with per-source selectors and ad removal; extraction quality metrics + drift detection; event-grouping ladder (groupingKey → embedding → LLM comparator); classification→event rollup; two-tier early-warning/confirmed alerting with latency SLO watchdog; real-HTML fixture harness; deterministic local test source; labelled evaluation module; BullMQ worker skeleton.

Pending: wire semantic dedup vector into the dedup stage; per-article push-through workers; grouping-key aliases; tier-0/1 sources with trust_level wired into confidence; analyst copilot agent (LangGraph); notification channels.

## Guardrails

- Never alert on generic cybersecurity commentary
- Always store source URL and retrieved timestamp
- Do not suppress same-event material updates
- Label low-confidence early-warning signals clearly
