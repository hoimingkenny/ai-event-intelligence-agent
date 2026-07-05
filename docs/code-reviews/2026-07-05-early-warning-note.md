# Code Review: Early-warning redesign engineering note

- **Branch:** `docs/early-warning-note` → `main`
- **Date:** 2026-07-05
- **Reviewer:** Claude

## Summary of change

Docs-only. Adds `docs/engineering-notes/early-warning-redesign.md` — the narrative record of the news-trading re-review: the alert gate that structurally suppressed early signals (policy/mission mismatch), FIFO ordering, the unmeasured latency SLO, plus the two deliberately deferred findings (grouping-key aliases, tier-0/1 sources) and the transferable lesson about implicit precision/recall judgments in gate conditions. Indexed in `docs/README.md`.

## Behaviour changes

None — documentation only.

## Test evidence

Not applicable; content cross-checked against `alert-decision.ts`, `alert-latency.ts`, and the `2026-07-02-early-warning-alerting` review.

## Verdict

**Approve.** The strongest design story in the project, now written down where the code reviews can reference it.
