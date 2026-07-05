# Documentation

Three categories, organized by *why* a document exists rather than what feature it covers.

## `plans/` — implementation plans

Forward-looking documents: what we intend to build, phased roadmaps, scope decisions. A plan is a snapshot of intent — it is not updated to match reality after the fact (the code and design docs do that job).

| Document | Scope |
|---|---|
| [ai-event-intelligence-agent-plan.md](plans/ai-event-intelligence-agent-plan.md) | Overall project plan: staged agent workflow, goals, phases |
| [rss-vector-pipeline-implementation-plan.md](plans/rss-vector-pipeline-implementation-plan.md) | RSS ingestion + vector dedup pipeline implementation plan |

## `design/` — system design reference

The current-state reference: how the system is shaped and why. These documents are kept up to date as the system evolves.

| Document | Scope |
|---|---|
| [architecture.md](design/architecture.md) | Design principles; LLM-inside-deterministic-workflow model |
| [data-model.md](design/data-model.md) | Core tables and the article-vs-event separation |
| [evaluation.md](design/evaluation.md) | Evaluation methodology: item/event-level metrics + human review dashboard |
| [tradeoffs.md](design/tradeoffs.md) | Deliberate trade-offs and their rationale |
| [limitations.md](design/limitations.md) | Known limits of the current approach |

## `engineering-notes/` — technical write-ups

Post-hoc writing about a specific challenge: what broke, how it was debugged, what was learned. Written once, rarely edited — they capture the reasoning at a point in time.

| Document | Scope |
|---|---|
| [extraction-quality-evaluation.md](engineering-notes/extraction-quality-evaluation.md) | Article extraction cleaning layers, debugging notes, quality metrics + drift detection |
| [agent-framework-decision.md](engineering-notes/agent-framework-decision.md) | Where LangGraph earns its place (runner, copilot) and where it deliberately does not (pipeline stages) |

## `code-reviews/` — pre-merge reviews

One document per merge to `main`, written before merging (see the Development Workflow section in `CLAUDE.md`). Copy [TEMPLATE.md](code-reviews/TEMPLATE.md), name it `YYYY-MM-DD-<topic>.md`.

| Document | Scope |
|---|---|
| [2026-07-02-readability-extraction.md](code-reviews/2026-07-02-readability-extraction.md) | Readability extraction + quality metrics + drift detection |
| [2026-07-02-event-grouping-ladder.md](code-reviews/2026-07-02-event-grouping-ladder.md) | Event-grouping ladder (key → embedding → LLM) + classification feedback |
| [2026-07-02-local-test-source.md](code-reviews/2026-07-02-local-test-source.md) | Deterministic local test source + ad-removal nesting fix |
| [2026-07-02-early-warning-alerting.md](code-reviews/2026-07-02-early-warning-alerting.md) | Two-tier alerting, material-update bypass, newest-first, latency SLO |
| [2026-07-02-design-docs-refresh.md](code-reviews/2026-07-02-design-docs-refresh.md) | Design docs brought in line with implemented system |
| [2026-07-02-langgraph-runner.md](code-reviews/2026-07-02-langgraph-runner.md) | Pipeline runner converted to LangGraph StateGraph |
| [2026-07-02-agent-framework-decision-doc.md](code-reviews/2026-07-02-agent-framework-decision-doc.md) | Engineering note: agent framework decision record |
| [2026-07-02-consolidate-agents-md.md](code-reviews/2026-07-02-consolidate-agents-md.md) | AGENTS.md canonical; CLAUDE.md becomes an @import |

## Conventions

New document? Pick the folder by intent: proposing future work → `plans/`; describing how the system works today → `design/`; narrating a solved problem → `engineering-notes/`; reviewing a change before merge → `code-reviews/`. Add a row to the matching table above.
