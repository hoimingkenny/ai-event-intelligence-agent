# Code Review: Publish interview-prep docs

- **Branch:** `docs/publish-interview-prep` → `main`
- **Date:** 2026-07-05
- **Reviewer:** Claude

## Summary of change

Docs-only, owner's decision. `docs/interview/` (pitch, design decisions, war stories, Q&A prep) moves from gitignored-local to committed-public: the `.gitignore` entry is removed, the folder README reframed from "never commit" to "published deliberately — every claim verifiable against code and review history", and the folder indexed in `docs/README.md`.

## Behaviour changes

None to code. The repository now openly documents interview positioning derived from the project.

## Risks and concerns

Interviewers reading the repo will see the prepared narratives, including coaching meta-commentary ("this framing lands well in interviews"). Accepted deliberately by the owner; the mitigating factor is that every story cross-references real commits, tests, and review docs — the material reads as engineering retrospective with an audience, not fabrication. The candidate should still expect follow-up questions that go beyond the written answers.

## Test evidence

Not applicable (docs only).

## Verdict

**Approve.** Owner's call on a visibility trade-off, cleanly executed with the framing updated to match.
