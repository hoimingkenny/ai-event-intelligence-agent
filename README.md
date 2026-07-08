# Vendor Threat Watch

AI-assisted cyber early-warning and vendor-impact triage.

The goal is not a generic cyber news summary. It is to identify fresh cyber events, map them to a monitored vendor inventory, deduplicate related reports across sources into canonical events, and surface items that may need review within a **2-hour impact window** — alerting like a news desk: a labeled early signal now, upgraded to confirmed later.

**Design principle: the LLM is not the system of record.** It performs bounded, schema-validated reasoning (classify, compare, summarize) inside a deterministic workflow. PostgreSQL is the source of truth; every stage is a state-machine transition, independently retryable and auditable. Deterministic tiers resolve the large majority of decisions for free — the LLM only sees the genuinely ambiguous cases.

## Pipeline

Articles move through a state machine on `articles.processing_status`. Each stage picks up what the previous one advanced, so a crashed run resumes by simply running again.

```text
ingest      RSS feeds → new article records
   ↓
filter      cheap regex/keyword/CVE/vendor match → drop irrelevant before any expensive work
   ↓
extract     layered cleaning: per-source selectors → Readability → boilerplate & ad removal
   ↓         (self-scores rss_recall = word recall of RSS summary vs extracted text)
entities    deterministic vendor/CVE/IOC/attack-type extraction, confidence-scored by
   ↓         placement (title strong, footer weak) + corroboration
embed       article embeddings (pgvector)
   ↓
dedup       content hash → title hash → semantic similarity
   ↓
events      grouping ladder: grouping-key match → embedding distance → LLM comparator
   ↓         (only in the uncertain band); low-confidence entities gated out
classify    LLM classification → rolls up into event severity/urgency/confidence;
   ↓         cross-checks deterministic vendors against the LLM's vendor roles
alerts      two-tier: early_warning (fresh, labeled unconfirmed) → confirmed (strict gate);
             material updates bypass suppression
```

Two watchdogs run inside every pass: **extraction drift** (per-source rolling recall — a site redesign surfaces the same day) and **alert latency** (publication→alert p50/p90 vs the 2h SLO). Every LLM call is recorded in `llm_audit_logs`.

Orchestration is a LangGraph StateGraph (`src/pipeline/runner.ts`) that owns sequencing only. Full design: [`docs/design/architecture.md`](docs/design/architecture.md).

## Tech stack

- **TypeScript** (Node 22), run via `tsx`
- **PostgreSQL + pgvector** (HNSW) — source of truth and semantic retrieval
- **LangGraph** — pipeline orchestration (analyst copilot planned)
- **MiniMax** (OpenAI-compatible) — LLM reasoning + embeddings
- **Redis + BullMQ** — background queue mode (optional)
- **Mozilla Readability + linkedom** — article extraction
- **vitest** — tests

## Quick start

```bash
npm install
cp .env.example .env          # set MINIMAX_API_KEY (needed for embeddings + LLM stages)

docker compose up -d postgres redis
npm run db:migrate            # apply SQL migrations (src/db/migrations/)
npm run db:seed               # seed RSS feeds + monitored vendor inventory

npm run pipeline:run          # run the full pipeline once (advisory-locked)
```

Without `MINIMAX_API_KEY` the pipeline still runs, but the embedding and classification stages are skipped/degraded (dedup loses its semantic tier).

### Manual articles only

Use this path when you want to test only `eval/datasets/manual-articles.jsonl` and avoid live RSS ingest:

```bash
npm run db:migrate
npm run seed:vendors
npm run articles:manual
npm run pipeline:run -- --skip-ingest --include-llm --limit=50
```

## Running continuously (every 20 minutes)

Two deployment patterns share one advisory-locked core, so overlapping runs are skipped, not stacked:

```bash
# Internal scheduler (self-contained loop)
npm run scheduler             # runs the pipeline every RSS_FETCH_INTERVAL_MINUTES (default 20)

# Full stack in Docker (postgres → migrate → scheduler → optional dashboard)
docker compose up -d
```

For an external scheduler (system cron / Kubernetes CronJob), invoke the one-shot `npm run pipeline:run` on your own cadence. Design details: [`docs/engineering-notes/deployment-and-scheduling.md`](docs/engineering-notes/deployment-and-scheduling.md).

## Testing and evaluation

### Deterministic local test source

Live RSS changes constantly, which makes the pipeline hard to study. A frozen local "news site" lets you replay identical runs:

```bash
npm run test-source:serve     # terminal 1 — serves 5 scenario articles at :8787

# terminal 2 — register the feed once (psql):
#   INSERT INTO feeds (source_name, feed_url, source_type, trust_level, is_active)
#   VALUES ('Test Security News','http://localhost:8787/feed.xml','rss','high',true)
#   ON CONFLICT (feed_url) DO UPDATE SET is_active = true;

npm run ingest:rss -- --feed-url=http://localhost:8787/feed.xml
npm run filter:articles && npm run extract:articles   # ... walk stages one at a time
```

The scenarios exercise grouping-key attach, separate events, native-ad removal, and cheap-filter rejection. You can truncate and replay because the content never changes.

### Unit tests and type-checking

```bash
npm run check                 # tsc --noEmit
npm test                      # vitest (~130 tests; decision logic is pure, no DB needed)
```

### Quality evaluation

```bash
npm run eval                  # run the labelled eval set (data/labelled-eval-set.json)
npm run drift:check           # per-source extraction quality (exit 2 on drift)
npm run latency:check         # publication→alert p50/p90 vs 2h SLO (exit 2 on violation)
```

### Monitoring portal (articles + events)

A read-only web portal with two views:

- **Articles** — every article with its status, scores, extraction quality, and closest monitored vendor; click a row to inspect entities/events/alerts and **preview the extracted text**.
- **Events** — deduplicated incidents, multi-source first; click one to see its channel-ready summary, affected vendors/products, and **sources as a timeline** (first report → follow-ups), each linking to the original and the extracted preview.

```bash
npm run portal                # http://127.0.0.1:4322 (Articles | Events tabs)
npm run summarize:events      # regenerate missing/stale event titles + summaries
```

### Human review dashboard

Inspect every pipeline decision per article and record per-dimension verdicts:

```bash
npm run review:dashboard      # http://127.0.0.1:4321 (attention-first queue)
```

### Extraction fixtures

```bash
npm run fixtures:fetch -- <url>   # save real article HTML as a regression fixture
npm run fixtures:review           # side-by-side original vs extracted report
```

## Inspecting results (psql)

```bash
docker exec -it vendor_threat_watch_postgres psql -U cyber -d vendor_threat_watch

SELECT processing_status, count(*) FROM articles GROUP BY 1;
SELECT id, grouping_key, severity, confidence, source_count FROM cyber_events;
SELECT event_id, alert_tier, alert_status, alert_reason FROM alerts;
```

## Individual stage commands

`ingest:rss`, `filter:articles`, `extract:articles`, `entities:articles`, `embed:articles`, `embed:events`, `dedup:articles`, `events:articles`, `classify:articles`, `alerts:events` — each runs one stage, useful for studying the flow step by step.

## Documentation

See [`docs/README.md`](docs/README.md) for the full index. Highlights:

- [`docs/design/`](docs/design/) — architecture, data model, evaluation methodology, trade-offs, limitations
- [`docs/engineering-notes/`](docs/engineering-notes/) — extraction quality, event-grouping ladder, early-warning redesign, entity confidence, deployment, agent-framework decision
- [`docs/plans/production-readiness.md`](docs/plans/production-readiness.md) — prototype → enterprise-grade roadmap
- [`docs/code-reviews/`](docs/code-reviews/) — a pre-merge review doc per change

## Development workflow

No direct commits to `main`; every change goes on a branch with a pre-merge code-review doc in `docs/code-reviews/`, and `npm run check` + `npm test` must pass. See [`AGENTS.md`](AGENTS.md).

## Notes

- **Legacy scaffold** (`src/graph.ts`, `src/nodes/`, `src/agents/`, `src/storage/`) is the superseded in-memory/Qdrant era, kept for reference. `npm run dev` runs that old scaffold, not the real pipeline — use `pipeline:run`.
- The Playwright extraction fallback is disabled by default; current feeds are server-rendered.
- MiniMax embedding dimensions are auto-detected on first call (its `/v1/embeddings` uses a non-standard `{model, type, texts}` request shape).
