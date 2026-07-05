# Code Review: Consolidate agent guidance into AGENTS.md

- **Branch:** `chore/consolidate-agents-md` → `main`
- **Date:** 2026-07-02
- **Reviewer:** Claude

## Summary of change

`AGENTS.md` (added as a Codex-targeted copy of CLAUDE.md) becomes the single canonical agent-guidance file, with a tool-neutral header. `CLAUDE.md` is reduced to a one-line `@AGENTS.md` import — Claude Code resolves `@file` imports in CLAUDE.md, so it reads the same content from the same source of truth.

Rationale: the guidance file changed three times today alone; two full copies guarantee drift, and drifted guidance means different AI tools working from different workflow rules, guardrails, and invariants — the least detectable kind of divergence.

## Behaviour changes

None to code. Claude Code and Codex now read identical guidance by construction.

## Risks and concerns

If a tool reads CLAUDE.md without supporting `@` imports, it sees only the pointer. Accepted: Claude Code supports imports, Codex reads AGENTS.md directly, and the pointer makes the location of the real content obvious to anything else.

## Test evidence

Not applicable (docs/config only). `diff` confirmed the two files were byte-identical apart from the header before consolidation.

## Verdict

**Approve.** One source of truth for agent guidance; drift eliminated by construction.
