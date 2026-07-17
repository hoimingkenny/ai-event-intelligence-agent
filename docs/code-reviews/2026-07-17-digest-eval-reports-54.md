# Code Review: Digest eval Workspace reports panel (#54)

- **Branch:** `feat/digest-eval-runner-53` → `main`
- **Commits:** (with #52–#53 on same branch)
- **Date:** 2026-07-17
- **Reviewer:** Auto (implement)

## Summary of change

Completes Workspace digest eval with a Reports tab: run baseline/regen from the UI, pick finished runs, view scorecard (metrics, soft gates, failures, baseline delta), and run an on-demand diagnostic agreement judge. Thin surface over the #53 scoring/runner seam.

## Behaviour changes

- `/workspace/eval/digest/reports` is a working analyst surface (was a stub).
- Server actions trigger `runDigestEval` (baseline/regen) and persist runs/predictions; UI does not write report files (`formats: []`).
- Agreement report is LLM-backed, diagnostic only, never writes gold.
- Soft-gate inactive banner when gold count &lt; 40.

## Risks and concerns

- **Long-running actions:** Regen and agreement can take minutes on ~50 gold labels; Next.js server actions may time out in constrained hosts. Accepted for PoC; CLI remains available.
- **Agreement cost:** One LLM call per gold sample; concurrency follows `llmConcurrency`.
- **Failed predictions:** Same empty-prediction scoring behaviour as #53 when rebuilding reports from DB.

## Test evidence

- `npm run check` — pass
- `npx tsc --noEmit` (web/) — pass
- Digest agreement / report-load / eval tests — pass
- `npm test` — 376 pass, 2 fail (pre-existing `llmHelpers.test.ts` MiniMax network), 6 skipped

## Follow-ups

- Progress UI / background jobs for long regen/agreement runs.
- Surface prediction `error_message` in failure rows.
- Split pending state so agreement does not disable baseline/regen buttons.

## Verdict

**Approve-with-notes** — Meets #54 acceptance criteria; long-running server-action timeout risk accepted for PoC.
