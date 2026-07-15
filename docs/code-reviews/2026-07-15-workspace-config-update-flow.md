# Code Review: Workspace Config update-flow design record

- **Branch:** `docs/workspace-config-update-flow` → `main`
- **Commits:** (this branch)
- **Date:** 2026-07-15
- **Reviewer:** Auto (Composer)

## Summary of change

Adds a design reference documenting the agreed Config hub update flow (Postgres + UI immediate; pipeline on next run; soft-deactivate; filter re-queue escape hatch) for [PRD #34](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/34). No application code.

## Behaviour changes

None — documentation only.

## Risks and concerns

- Doc describes behaviour that tickets #35–#39 will implement; if tickets diverge, update this design note. Accepted: intentional record of the grill decisions.

## Test evidence

- N/A (docs only). No `npm run check` / `npm test` required for this PR.

## Follow-ups

- Implement #35–#39 against this flow; optionally formalize inventory SoT ADR later.

## Verdict

Approve — durable record of Config before/after semantics linked from the docs index and PRD.
