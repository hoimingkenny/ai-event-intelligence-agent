# Vendor Threat Watch

AI-assisted cyber early-warning and vendor-impact triage agent.

The goal is not to produce a generic cyber news summary. The goal is to identify fresh cyber events, map them to monitored vendor products, deduplicate related reports into canonical events, and surface only items that may require review within a 2-hour incident response window.

## MVP Flow

```text
User request: "Find latest cyber attack news of today"

1. Build time-sensitive search plan
2. Run web search
3. Store raw search/article records
4. Extract cyber facts
5. Match monitored vendors/products
6. Retrieve candidate duplicate events
7. Decide same event / material update / separate event
8. Score urgency
9. Print analyst triage report
```

## Tech Stack

- TypeScript
- MiniMax (OpenAI-compatible) for LLM reasoning and embeddings
- OpenAI Agents SDK for specialist reasoning agents
- LangGraph for workflow orchestration
- Qdrant for vector-based deduplication
- RSS feeds (CISA, Krebs, Bleeping Computer, The Hacker News) for cyber signal
- PostgreSQL later as canonical store

## Setup

```bash
npm install
cp .env.example .env
# Add your MINIMAX_API_KEY to .env

# Optional: start Qdrant for vector dedup
./scripts/qdrant-up.sh

npm run dev
```

## Notes

- Vector dedup is optional: if Qdrant is unreachable, the dedup agent falls back to
  structured-signal matching (CVE / vendor+product+type) only.
- Embedding dimensions are auto-detected on first call to MiniMax's `/v1/embeddings`
  endpoint, which uses a non-standard `{model, type, texts}` request shape distinct
  from the OpenAI JS SDK's `embeddings.create({ input })`.
