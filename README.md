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
- PostgreSQL + pgvector for durable article/event storage and semantic retrieval
- Redis for future background job queues
- Qdrant for vector-based deduplication
- RSS feeds (CISA, Krebs, Bleeping Computer, The Hacker News) for cyber signal

## Setup

```bash
npm install
cp .env.example .env
# Add your MINIMAX_API_KEY to .env

# Pull local database/queue images first if they are not already present.
docker compose pull postgres redis

# Start PostgreSQL with pgvector and Redis.
docker compose up -d postgres redis

# Apply database migrations.
npm run db:migrate

# Seed configured RSS feeds and monitored vendors.
npm run db:seed

# Optional during the Qdrant prototype transition: start Qdrant for vector dedup.
./scripts/qdrant-up.sh

npm run dev
```

## Docker Notes

The Postgres image comes from `pgvector/pgvector:pg18`, so pulling it before first
startup is useful on a fresh machine:

```bash
docker compose pull postgres
docker compose pull redis
docker compose up -d postgres redis
docker compose ps
```

Equivalent direct image pulls:

```bash
docker pull pgvector/pgvector:pg18
docker pull redis:8
```

After the containers are healthy, run:

```bash
npm run db:migrate
npm run db:seed
```

PostgreSQL 18 stores container data under a major-version-specific layout. This
Compose file mounts the database volume at `/var/lib/postgresql` and uses a
`postgres18_data` volume so it does not collide with older Postgres volumes.

## Notes

- Vector dedup is optional: if Qdrant is unreachable, the dedup agent falls back to
  structured-signal matching (CVE / vendor+product+type) only.
- Embedding dimensions are auto-detected on first call to MiniMax's `/v1/embeddings`
  endpoint, which uses a non-standard `{model, type, texts}` request shape distinct
  from the OpenAI JS SDK's `embeddings.create({ input })`.
