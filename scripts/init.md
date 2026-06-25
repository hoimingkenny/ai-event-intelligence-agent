# Codex Prompt

Use this project as the scaffold for an AI Vendor Cyber Early-Warning Agent.

## Immediate Tasks

1. Replace `src/tools/searchTool.ts` with the approved OpenAI WebSearchTool integration.
2. Replace deterministic extraction in `src/agents/extractionAgent.ts` with OpenAI Agents SDK structured output.
3. Convert `src/graph.ts` into a formal LangGraph `StateGraph`.
4. Add PostgreSQL schema for raw articles, security events, event-article links, vendor inventory, and notification logs.
5. Add deduplication tests for:
   - same URL
   - same CVE
   - same vendor/product/event type
   - material update
   - separate events involving same vendor

## Guardrails

- Never alert on generic cybersecurity commentary.
- Always store source URL and retrieved timestamp.
- Do not suppress same-event material updates.
- Label low-confidence early-warning signals clearly.
