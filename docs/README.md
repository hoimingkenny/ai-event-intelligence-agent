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
| [evaluation.md](design/evaluation.md) | Evaluation methodology: item/event-level metrics |
| [tradeoffs.md](design/tradeoffs.md) | Deliberate trade-offs and their rationale |
| [limitations.md](design/limitations.md) | Known limits of the current approach |

## `engineering-notes/` — technical write-ups

Post-hoc writing about a specific challenge: what broke, how it was debugged, what was learned. Written once, rarely edited — they capture the reasoning at a point in time.

| Document | Scope |
|---|---|
| [extraction-quality-evaluation.md](engineering-notes/extraction-quality-evaluation.md) | Article extraction cleaning layers, debugging notes, quality metrics + drift detection |

## Conventions

New document? Pick the folder by intent: proposing future work → `plans/`; describing how the system works today → `design/`; narrating a solved problem → `engineering-notes/`. Add a row to the matching table above.
