# Code Review: Human review dashboard and quality-control loop

- **Branch:** `feat/human-review-dashboard` -> `main`
- **Commits:** this branch
- **Date:** 2026-07-05
- **Reviewer:** Codex

## Summary of change

Adds a local human review dashboard for monitoring AI/pipeline decisions and capturing structured human verdicts. The dashboard exposes recent articles with pipeline status, extraction content, detected entities, LLM classification output, event grouping, alerts, and LLM audit entries. Human verdicts are persisted in Postgres (`human_review_verdicts`) so wrong tags and wrong decisions become auditable quality-control data.

The design docs now frame the dashboard as both a monitoring surface and a quality-control loop: human review should feed evaluation evidence before any prompt, threshold, rule, or model behavior changes.

## Behaviour changes

- New commands:
  - `npm run review:dashboard` starts the interactive local dashboard at `127.0.0.1:4321`.
  - `npm run review:report` writes a static review snapshot to `review/human-dashboard/index.html`.
- New migrations:
  - `007_human_review_verdicts.sql` creates `human_review_verdicts`.
  - `008_human_review_llm_verdict.sql` adds an explicit LLM classification verdict.
- `.gitignore` now ignores only root-level `/review/`, so source files under `src/review/` are trackable.

## Risks and concerns

- **Feedback capture is not yet evaluation improvement.** Verdicts are stored, but there is no `review:export` or `eval --from-human-reviews` path yet. Accepted for this slice; the docs explicitly call out the quality-control loop.
- **Local-only dashboard has no auth.** The server binds to `127.0.0.1` by default. Do not expose it on a shared interface without adding authentication and CSRF protection.
- **Human labels can be partial or noisy.** The schema stores per-dimension verdicts and notes, but reviewer agreement, adjudication, and expected correction fields are follow-ups.
- **Manual HTML/JS UI is intentionally minimal.** It avoids adding a frontend framework before the review loop is proven, but should be split if the UI grows.

## Test evidence

- `npm run check` passed.
- Focused tests passed: `npx vitest run tests/human-review-dashboard.test.ts tests/human-review-server.test.ts tests/migrations.test.ts`.
- Local dashboard API was smoke-tested against Postgres during development.

## Follow-ups

- Export reviewed verdicts into an evaluation dataset and report quality metrics over time.
- Add expected/corrected labels, not only verdicts, for vendor role, alert tier, grouping relation, and severity/urgency.
- Distinguish `review_started` from `review_complete`.
- Add authentication before any non-local deployment.

## Verdict

**Approve with notes.** The change establishes the right production-AI feedback primitive: observable decisions plus auditable human corrections, without letting the LLM become the system of record.
