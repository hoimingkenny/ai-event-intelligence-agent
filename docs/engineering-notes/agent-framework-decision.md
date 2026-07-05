# When an Agent Framework Earns Its Place

Decision record for adopting LangGraph — where it applies, where it deliberately does not, and the boundary rule that keeps the architecture honest.

## The question

Should this project use an agent SDK (LangGraph, OpenAI Agents SDK, or similar)? The repo had two candidate dependencies from different eras: `@openai/agents` (legacy scaffold) and `@langchain/langgraph` (planned runner conversion). "We should use an agent framework" and "we are an AI agent project" are not the same claim — this note records where the line sits.

## Decision: no framework inside the pipeline stages

The pipeline's LLM calls (classify, compare, summarize) are single, bounded, zod-validated invocations inside a deterministic state machine. There is no tool selection, no multi-turn state, no loop — nothing an agent abstraction would manage. Wrapping those calls in a framework adds an abstraction layer with zero benefit and obscures the property that makes the pipeline valuable: every decision is a state-machine transition on Postgres, independently retryable and auditable.

Refactoring working deterministic stages into agent abstractions is résumé-driven engineering. The pipeline's value *is* its determinism.

## Decision: LangGraph for orchestration and the analyst copilot

Two components genuinely benefit:

**The runner** (implemented — see `src/pipeline/runner.ts`, review `2026-07-02-langgraph-runner.md`). A StateGraph with one node per stage, watchdog nodes for drift and latency, and one conditional edge (skip LLM classification without an API key). The conversion was mechanical by design: `runPipeline`'s contract is unchanged and the graph owns *sequencing only* — Postgres `processing_status` remains the system of record, so crash recovery is still "run it again."

**The analyst copilot** (planned). This is a real agent: multi-turn conversation, dynamic tool selection (`query_events`, `search_articles`, `get_vendor_exposure`), streaming, session state, and human-in-the-loop confirmation. Hand-rolling a tool-calling loop with retries, parallel dispatch, and interrupt/resume is reinventing a wheel frameworks have already debugged.

## Why LangGraph over the alternatives

- **Provider-agnostic**: works with the MiniMax OpenAI-compatible client today and survives a provider swap — consistent with the provider-abstraction trade-off already in `tradeoffs.md`.
- **Checkpointing and interrupts** map directly onto the `uncertain_need_human_review` path: the copilot pauses on uncertain decisions and resumes after human input.
- **One framework, two jobs**: the same library orchestrates the pipeline graph and the copilot agent. Two overlapping frameworks (`@openai/agents` + LangGraph) doing similar jobs is incoherence, not optionality — `@openai/agents` leaves with the legacy scaffold.

## The boundary rule

**The SDK owns the conversation loop; the pipeline stays the tool layer.**

- The copilot's tools are read-only queries over Postgres.
- The tool allowlist is enforced in code, not in the prompt.
- Anything that mutates state — sending alerts, merging events, changing rules — requires human confirmation via interrupt.

This keeps "LLM is not the system of record" true even after an agent moves in. An agent framework in this architecture is a *client* of the pipeline, never its owner.

## Implementation gotcha

LangGraph forbids node names that collide with state channel names — pipeline nodes are suffixed `_stage` (`ingest_stage`, `filter_stage`, …). Adding a node named after its result key fails at graph construction with "already being used as a state attribute."

## Sequence

1. ✅ Runner → StateGraph (mechanical, validated the framework against the state machine, contract unchanged)
2. Copilot agent on LangGraph: read-only tools + interrupt-based human confirmation
3. Drop `@openai/agents` with the legacy scaffold
4. Checkpointer for graph-level resume once the copilot needs session persistence
