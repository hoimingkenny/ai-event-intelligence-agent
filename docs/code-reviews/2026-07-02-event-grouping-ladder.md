# Code Review: Event-grouping ladder + classification feedback

- **Branch:** `feat/event-grouping-ladder` → `main`
- **Commits:** (this branch)
- **Date:** 2026-07-02
- **Reviewer:** Claude

## Summary of change

Replaces title-string event matching with the three-rung ladder the architecture docs promised: exact `grouping_key` match (deterministic, free) → event-embedding cosine distance bands (attach ≤ 0.15, uncertain ≤ 0.35) → LLM comparator for the uncertain band only. Wires the previously dead `compareArticleToEvent` into the pipeline with full LLM audit logging. Classification results now roll up into event severity/urgency/confidence (`rollUpEventAssessment`), replacing the hardcoded `confidence=0.6` that the alert gate was previously comparing against a constant.

Decision logic is pure (`src/events/grouping-decision.ts`, `src/events/event-assessment.ts`); the stage only orchestrates I/O — that's what makes the ladder unit-testable without a database.

## Behaviour changes

- **Migration required** (`005_event_grouping_key.sql`): `cyber_events.grouping_key` + partial index on open events. Migrate before deploy.
- **Events are now grouped across sources**: previously each differently-titled article created its own event; expect fewer, larger events after deploy.
- **`isPrimarySource` bug fixed**: the old `created > 0` marked every subsequent attach in a batch as primary; now only the creating article is primary.
- **Comparator failure fails open to a new event** (spurious split is recoverable by later merge; silently fusing two incidents is not) with an `error` row in `llm_audit_logs`.
- **`EventStageResult` / `ClassificationStageResult` gained fields** (attachedByKey/attachedByEmbedding/attachedByLlm/llmCompared; eventsUpdated) — additive, no callers broken.
- Alert confidence gate (`MIN_ALERT_CONFIDENCE=0.75`) now operates on a real signal: single-source events start ~0.6–0.77 depending on LLM confidence; corroboration (+0.1/source, cap 3) pushes multi-source events over the gate. Alert volume will change — monitor after deploy.

## Risks and concerns

- **Embedding thresholds (0.15 / 0.35) are unvalidated priors.** They bound which pairs reach the LLM; wrong values either leak LLM cost or split events. Mitigated: exported constants, easy to tune against the labelled eval set (follow-up).
- **New events lack embeddings until `embed:events` runs**, so same-run duplicates rely on the grouping key. Articles with no entities (`unknown` key) and no embedding can still create sibling events — accepted, matches previous behaviour at worst.
- **Confidence formula is heuristic** (0.35 + 0.4·LLM + 0.1·corroboration). Deliberately explainable rather than learned; documented in code. Never-downgrade semantics mean a bad early classification can pin severity high — accepted for a triage system (fail alarming, not silent).
- **One extra query per grouped article** (`getEmbedding` + `findSimilarEvents` when key misses). HNSW-indexed; negligible at current volumes.

## Test evidence

- `npm run check` clean.
- `vitest`: 88 passed / 4 skipped; 12 new tests covering every rung boundary (key match, unknown-key exemption, attach/uncertain/create distance bands, comparator verdicts incl. material update) and rollup semantics (upgrade, never-downgrade, corroboration bonus, not-relevant cap, ceiling). Only failures are the 3 pre-existing live MiniMax API tests (network-gated).

## Follow-ups

Tune distance thresholds against the labelled eval set; event merge tooling for spurious splits; comparator batching if uncertain-band volume grows; summarizer (`EventSummarySchema`) still unwired.

## Verdict

**Approve.** The ladder matches the documented design, the LLM only sees the ambiguous band, every decision path is audit-logged and unit-tested, and the one behavioural gamble (fail-open on comparator error) is the conservative direction for an early-warning system.
