# Code Review: Agent framework decision record

- **Branch:** `docs/agent-framework-decision` → `main`
- **Date:** 2026-07-02
- **Reviewer:** Claude

## Summary of change

Docs-only. Adds `docs/engineering-notes/agent-framework-decision.md` recording the LangGraph adoption decision: framework for the runner graph and the planned analyst copilot; explicitly *not* for pipeline stages; boundary rule ("SDK owns the conversation loop, pipeline stays the tool layer — a client of the pipeline's state, never its owner"); why LangGraph over `@openai/agents` (provider-agnostic, interrupts map to `uncertain_need_human_review`, one framework for both jobs); the node/channel naming gotcha; and the implementation sequence. Cross-referenced from `tradeoffs.md` and indexed in `docs/README.md`.

## Behaviour changes

None — documentation only.

## Test evidence

Not applicable; content cross-checked against `src/pipeline/runner.ts` and the langgraph-runner review.

## Verdict

**Approve.** Captures a decision that would otherwise live only in conversation history.
