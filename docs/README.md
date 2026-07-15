# Documentation

Three categories, organized by *why* a document exists rather than what feature it covers.

## `plans/` — implementation plans

Forward-looking documents: what we intend to build, phased roadmaps, scope decisions. A plan is a snapshot of intent — it is not updated to match reality after the fact (the code and design docs do that job).

Active plans: none at the moment.

### `plans/archive/` — completed / superseded plans

| Document | Scope |
|---|---|
| [ai-event-intelligence-agent-plan.md](plans/archive/ai-event-intelligence-agent-plan.md) | Overall project plan: staged agent workflow, goals, phases |
| [rss-vector-pipeline-implementation-plan.md](plans/archive/rss-vector-pipeline-implementation-plan.md) | RSS ingestion + vector dedup pipeline implementation plan |
| [production-readiness.md](plans/archive/production-readiness.md) | Prototype → enterprise-grade: 8 pillars (current/target/done-when) + 4 phases |
| [merge-review-and-eval.md](plans/archive/merge-review-and-eval.md) | Merge `npm run review:dashboard` and `npm run eval:review` into a single server + page |
| [cheap-filter-layered-cascade-plan.md](plans/archive/cheap-filter-layered-cascade-plan.md) | Phased build-out of the layered cheap-filter cascade, gated on eval-dataset growth + recall acceptance |
| [events-page-title-and-ui.md](plans/archive/events-page-title-and-ui.md) | Stored LLM event titles/summaries (future channel payload) + six-column events table polish |

## `design/` — system design reference

The current-state reference: how the system is shaped and why. These documents are kept up to date as the system evolves.

| Document | Scope |
|---|---|
| [architecture.md](design/architecture.md) | Design principles; LLM-inside-deterministic-workflow model |
| [data-model.md](design/data-model.md) | Core tables and the article-vs-event separation |
| [evaluation.md](design/evaluation.md) | Evaluation methodology: item/event-level metrics + human review dashboard |
| [cyber-keyword-classification-standard.md](design/cyber-keyword-classification-standard.md) | Standard for cheap-filter cyber keyword categories, scoring, and false-positive control |
| [cheap-filter-rule-engine.md](design/cheap-filter-rule-engine.md) | Implemented cheap-filter cascade: signal extractors, vendor/context gates, priority score, and reason codes |
| [cheap-filter-layered-cascade.md](design/cheap-filter-layered-cascade.md) | Cheap-filter cascade design rationale: vendor gate → cyber-context gate → priority score, with severe-signal escape hatch |
| [ui-and-dashboards.md](design/ui-and-dashboards.md) | Dashboard surfaces: articles portal plus merged review/eval dashboard routes, data flow, shared patterns, deployment considerations |
| [tradeoffs.md](design/tradeoffs.md) | Deliberate trade-offs and their rationale |
| [limitations.md](design/limitations.md) | Known limits of the current approach |
| [workspace-config-update-flow.md](design/workspace-config-update-flow.md) | Config hub Feeds/Inventory: before/after for add/edit/soft-deactivate vs next pipeline run (#34) |

## `engineering-notes/` — technical write-ups

Post-hoc writing about a specific challenge: what broke, how it was debugged, what was learned. Written once, rarely edited — they capture the reasoning at a point in time.

| Document | Scope |
|---|---|
| [extraction-quality-evaluation.md](engineering-notes/extraction-quality-evaluation.md) | Article extraction cleaning layers, debugging notes, quality metrics + drift detection |
| [agent-framework-decision.md](engineering-notes/agent-framework-decision.md) | Where LangGraph earns its place (runner, copilot) and where it deliberately does not (pipeline stages) |
| [early-warning-redesign.md](engineering-notes/early-warning-redesign.md) | The alert gate that suppressed the product: two-tier alerting, newest-first, latency SLO |
| [entity-confidence-and-noise-tolerance.md](engineering-notes/entity-confidence-and-noise-tolerance.md) | Tolerating imperfect extraction: confidence-scored entities + event-boundary gate |
| [deployment-and-scheduling.md](engineering-notes/deployment-and-scheduling.md) | Running every 20 min: advisory-locked scheduling, Docker, compose ordering |
| [phase1-vps-cloudflare.md](engineering-notes/phase1-vps-cloudflare.md) | Phase-1 VPS Compose stack + Cloudflare TLS/domain (~$20/mo infra) |

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
| [2026-07-05-human-review-dashboard.md](code-reviews/2026-07-05-human-review-dashboard.md) | Human review dashboard + quality-control loop (with second-review addendum) |
| [2026-07-05-early-warning-note.md](code-reviews/2026-07-05-early-warning-note.md) | Engineering note: early-warning redesign record |
| [2026-07-05-publish-interview-prep.md](code-reviews/2026-07-05-publish-interview-prep.md) | Interview-prep docs made public |
| [2026-07-05-production-readiness-plan.md](code-reviews/2026-07-05-production-readiness-plan.md) | Production readiness roadmap (6 maturity levels) |
| [2026-07-05-consolidate-production-plan.md](code-reviews/2026-07-05-consolidate-production-plan.md) | Merge duplicate production plans into one canonical doc |
| [2026-07-05-entity-confidence.md](code-reviews/2026-07-05-entity-confidence.md) | Confidence-scored entities + corroboration gate |
| [2026-07-05-scheduled-deployment.md](code-reviews/2026-07-05-scheduled-deployment.md) | Scheduled deployment: advisory-locked every-20-min pipeline |
| [2026-07-05-readme-refresh.md](code-reviews/2026-07-05-readme-refresh.md) | Top-level README brought in line with the implemented system |
| [2026-07-05-articles-portal.md](code-reviews/2026-07-05-articles-portal.md) | Read-only article monitoring portal (status/scores/quality + preview) |
| [2026-07-05-portal-vendor-relevance.md](code-reviews/2026-07-05-portal-vendor-relevance.md) | Portal vendor relevance: closest monitored vendor + strength |
| [2026-07-05-portal-events-page.md](code-reviews/2026-07-05-portal-events-page.md) | Events page: list → detail with timeline of same-event sources |
| [2026-07-08-events-page-title-and-ui.md](code-reviews/2026-07-08-events-page-title-and-ui.md) | Event summary stage + channel-ready events portal UI |
| [2026-07-08-cheap-filter-layered-cascade.md](code-reviews/2026-07-08-cheap-filter-layered-cascade.md) | Cheap-filter layered cascade: vendor gate → cyber-context gate → priority score |

## `interview/` — interview preparation

Pitch, design-decision rationale, war stories, and Q&A prep derived from this project's history. Public by choice: the claims are verifiable against the code and the code-review trail.

## Conventions

New document? Pick the folder by intent: proposing future work → `plans/`; describing how the system works today → `design/`; narrating a solved problem → `engineering-notes/`; reviewing a change before merge → `code-reviews/`. Add a row to the matching table above.
