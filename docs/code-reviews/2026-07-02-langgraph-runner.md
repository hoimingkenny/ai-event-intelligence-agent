# Code Review: LangGraph StateGraph runner

- **Branch:** `feat/langgraph-runner` → `main`
- **Date:** 2026-07-02
- **Reviewer:** Claude

## Summary of change

Converts the sequential pipeline runner to a LangGraph StateGraph (`buildPipelineGraph`): one node per existing stage function, dedicated watchdog nodes (extraction drift, alert latency), linear edges, and one conditional edge that routes past LLM classification when no API key is configured. `runPipeline` keeps its exact signature and result shape — scripts, workers, and existing tests are untouched.

Deliberate scope limit: the graph owns *sequencing only*. Stage functions are unchanged and Postgres (`articles.processing_status`) remains the system of record, so crash-recovery semantics are identical (re-run the graph; stages pick up where the state machine says). This is groundwork for the analyst copilot agent (same framework, checkpointing/interrupt support for the human-review path) rather than a behavioural change.

## Behaviour changes

None intended. Stage execution order, watchdog placement, and the `includeLlm` skip are byte-for-byte the same policy as the sequential runner. New export `buildPipelineGraph` for future graph introspection/visualization.

## Risks and concerns

- **Framework surface**: LangGraph (v1.4.6) becomes load-bearing for orchestration. Mitigation: stages remain plain functions callable without the graph (worker path unchanged), so removal is a one-file revert.
- **Node/channel naming**: LangGraph forbids node names colliding with state channels — nodes are suffixed `_stage`. Noted here because it will bite anyone adding a node named after its result key.
- `graph.invoke({})` compiles per run — negligible overhead at pipeline cadence, avoids shared mutable graph state.

## Test evidence

`npm run check` clean; vitest 104 passed / 4 skipped (3 pre-existing MiniMax network failures). Two new tests: conditional edge takes the classification path when `includeLlm: true` (EmptyDb ⇒ no actual LLM calls), and ingest skip. Existing runner test passes unmodified.

## Follow-ups

Drop `@openai/agents` with the legacy scaffold; analyst copilot agent on LangGraph with read-only tools + interrupt-based human confirmation; optional checkpointer for graph-level resume once the copilot needs it.

## Verdict

**Approve.** Mechanical conversion with an unchanged contract, verified by the existing test passing untouched; establishes the framework where it will actually earn its keep (the copilot), without letting it become the system of record.
