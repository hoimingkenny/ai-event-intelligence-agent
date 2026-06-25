# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vendor Threat Watch is an AI-assisted cyber early-warning and vendor-impact triage agent. It identifies fresh cyber events, maps them to monitored vendor products, deduplicates related reports into canonical events, and surfaces items requiring review within a 2-hour incident response window.

**LLM is not the system of record** — it performs specialist reasoning inside a deterministic workflow.

## Commands

```bash
npm install          # Install dependencies
cp .env.example .env # Configure environment
npm run dev          # Run the application
npm run check        # Type-check TypeScript
npm test             # Run test suite (vitest)
npm run test:watch   # Run tests in watch mode
npm run test:eval    # Run evaluation sample
./scripts/qdrant-up.sh   # Start local Qdrant via Docker (for vector dedup)
```

## Architecture

```
src/graph.ts              # Simple orchestrator → will become LangGraph StateGraph
src/agents/               # OpenAI Agents SDK / MiniMax reasoning agents
  llmHelpers.ts          # callLLMWithSchema — JSON+strip-think-block helper
  searchPlannerAgent.ts   # Builds time-sensitive search plans
  extractionAgent.ts      # Extracts cyber facts from articles
  dedupAgent.ts           # Deduplication: Qdrant vector + structured-signal + LLM
  riskScoringAgent.ts     # Scores urgency/severity
src/nodes/                # LangGraph workflow nodes
  searchNodes.ts          # RSS feed fetcher (CISA, Krebs, Bleeping Computer, etc.)
  triageNodes.ts          # Article triage pipeline (extract → embed → dedup → upsert)
src/storage/              # Source of truth
  inMemoryStore.ts        # MVP event/article storage
  qdrantStore.ts          # Qdrant vector index for dedup candidate retrieval
  vendorInventory.ts      # Monitored vendors/products
src/config/               # Configuration
  env.ts                  # Env var reader
  llm.ts                  # MiniMax chat-completions client (OpenAI-compatible)
  embeddings.ts           # MiniMax embeddings client (non-standard /v1/embeddings)
  rssFeeds.ts             # Curated cyber threat RSS feeds
src/types/domain.ts       # Core domain types (CyberEventType, DedupRelationship, etc.)
src/tools/searchTool.ts   # RSS feed fetcher (replaces the original WebSearchTool stub)
```

## Two Operating Modes

**Early-Warning Mode**: Speed and freshness priority. Accepts low-confidence signals but labels them clearly. Triggered by prompts like "Find latest cyber attack news today."

**Confirmed Intelligence Mode**: Source confidence and confirmation priority. Triggered by prompts like "Summarise confirmed cyber incidents this week."

## Deduplication Result Types

`same_article_duplicate` → `same_event_no_new_information` → `same_event_new_source` → `same_event_material_update` → `related_but_separate_event` → `separate_event` → `uncertain_need_human_review`

## Current State

Done:
- LLM integration via MiniMax (OpenAI-compatible endpoint) at `src/config/llm.ts`
- Embeddings via MiniMax's non-standard `/v1/embeddings` endpoint at `src/config/embeddings.ts`
- RSS-based web signal at `src/tools/searchTool.ts` (CISA, Krebs, Bleeping Computer, The Hacker News)
- Qdrant vector dedup at `src/storage/qdrantStore.ts` (graceful fallback when Qdrant is down)
- Vitest test suite with stubable Qdrant store

Pending:
- Convert `src/graph.ts` to formal LangGraph `StateGraph`
- Add PostgreSQL schema and migrate from in-memory store
- Add `qdrant-down.sh` companion to `scripts/qdrant-up.sh`
- Add notification log persistence

## Guardrails

- Never alert on generic cybersecurity commentary
- Always store source URL and retrieved timestamp
- Do not suppress same-event material updates
- Label low-confidence early-warning signals clearly