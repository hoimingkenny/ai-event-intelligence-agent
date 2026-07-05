# Code Review: Consolidate duplicate production-readiness plans

- **Branch:** `docs/consolidate-production-plan` → `main`
- **Date:** 2026-07-05
- **Reviewer:** Claude

## Summary of change

Two overlapping production-readiness plans landed in the same commit (`b04bfb5`): `production-readiness.md` (6 maturity levels, mine) and `production-readiness-plan.md` (8 pillars, authored in parallel by the Codex session). My `git add docs/` swept in the parallel file. This consolidates to one.

The 8-pillar version is the deeper document — current/target/work-items/done-when per pillar, and it catches gaps the level version missed (SSRF on the fetcher, DR with honest RPO/RTO, state-machine-as-code). It was truncated mid-sentence (the parallel write was cut off). Resolution: keep the 8-pillar content under the already-indexed filename `production-readiness.md`, complete the truncated Pillar 8 ending, add a four-phase sequencing section (the one framing the level version had that the pillar version lacked), and delete the duplicate.

## Behaviour changes

None — docs only. Net: one canonical plan instead of two; `docs/README.md` index row updated to reflect the pillar/phase structure.

## Risks and concerns

Same lesson as the AGENTS.md consolidation: two docs on one topic guarantee drift. Root cause here was `git add docs/` staging a concurrently-created file — worth a habit of `git status` before broad adds when another agent may be writing.

## Test evidence

Not applicable (docs only). Verified one plan file remains and the index points to it.

## Verdict

**Approve.** Keeps the stronger of two parallel drafts, completes it, and removes the duplicate.
