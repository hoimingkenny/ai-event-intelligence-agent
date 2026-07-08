# Implementation Plan: Events Page — Stored LLM Titles + Table Polish

## Overview

Give every event a **stored, LLM-generated title and short summary** — generated inside the
pipeline, never at page view — and polish the portal's Events table into a six-column triage
surface. The generated title + summary is not portal decoration: it is the payload that will
eventually be posted to the notification channel, where an analyst reads it and pivots to their
own tooling.

## Architecture Decisions

Product decisions (review discussion, 2026-07-08):

- **CVEs disappear from the events list.** Analysts have a separate tool for CVE work; this portal
  answers "what happened, to which vendor/product, how bad, how fresh". CVEs remain in the event
  detail pane only because the data is already fetched there.
- **The title is prose only.** Vendor and product live in structured columns/chips, never encoded
  in the title string.
- **Severity is the single rating in the row.** Urgency stays detail-only.
- **First seen and last update share one column**, relative by default ("3h ago · updated 20m
  ago"), absolute UTC on hover.
- **No LLM calls at page view, ever.** The portal reads stored columns. Generation and
  regeneration happen in the pipeline; regeneration is triggered only by
  `same_event_material_update`, never by `same_event_new_source`.

Wiring discovery that shapes the plan — the machinery already exists, unwired:

| Piece | Where | State |
|---|---|---|
| `summarizeEvent()` — LLM call returning `title/summary/severity/urgency/confidence/keyFacts/recommendedActions` | `src/llm/summarizer.ts` + `EventSummarySchema` in `src/llm/schemas.ts` | implemented, zero call sites |
| `saveLlmSummary()` — persists that payload into `cyber_events.event_title/event_summary/severity/urgency/confidence` + `llm_summary` jsonb | `src/db/repositories/event.repository.ts` | implemented, zero call sites |
| Mechanical draft title ("X / Y vulnerability report") | `src/events/event-grouper.ts` | implemented — becomes the stored fallback |
| Material-update detection | `src/events/grouping-decision.ts` (`same_event_material_update`) | implemented — becomes the regeneration trigger |
| LLM audit trail | `llm_audit_logs` (migration 002) | implemented — new task gets a row like every other call |

## Non-goals

- **No notification channel implementation.** This plan makes the payload exist and be
  trustworthy; posting it anywhere is the separate channels work item.
- **No CVE features.** Not in the list, no count badges.
- **No portal redesign.** Same table + detail layout, same hand-rolled `innerHTML` pattern, no
  framework.
- **No dedup-ladder changes.** `same_event_material_update` semantics are consumed, not modified.

---

## Phase 1: Pipeline — Stored Event Summaries

### Task 1: Add `summary_stale` Flag

**Status:** Pending.

**Description:** New migration adding `summary_stale BOOLEAN NOT NULL DEFAULT false` to
`cyber_events`, plus a partial index for the stage's selection query
(`WHERE llm_summary IS NULL OR summary_stale`).

**Acceptance Criteria:**
- Migration applies cleanly on an existing database and on a fresh one.
- Existing rows default to `false`.

**Verification:**
- `npm run db:migrate` twice (idempotent).
- `npm test`

**Dependencies:** None

**Files Likely Touched:**
- `src/db/migrations/014_event_summary_stale.sql`
- `src/db/repositories/event.repository.ts` (row type)

**Estimated Scope:** Small

### Task 2: Set `summary_stale` on Material Updates

**Status:** Pending.

**Description:** When grouping resolves `same_event_material_update` for an existing event, set
`summary_stale = true` on that event. `same_event_new_source` must not set it — titles stay
stable while sources accrete; only genuine developments re-title.

**Acceptance Criteria:**
- Material update against an existing event marks it stale.
- New-source and no-new-information relationships leave the flag untouched.
- Aligns with the "do not suppress material updates" guardrail without churning operator
  recognition.

**Verification:**
- Unit tests driving `grouping-decision` outcomes through the event stage and asserting the flag.

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/pipeline/event-stage.ts`
- `src/events/grouping-decision.ts` (only if the relationship isn't already surfaced to the stage)
- `src/db/repositories/event.repository.ts`
- `tests/event-stage.test.ts` (or equivalent existing suite)

**Estimated Scope:** Small

### Task 3: Prompt Constraints and Title Cap

**Status:** Pending.

**Description:** Harden `summarizeEvent` for its new role as the channel payload. Title: hard
length cap on the schema field, present tense, no vendor/product prefix, no trailing
"report"/"advisory" filler. Summary: add "written to be posted to an alert channel and read
standalone" to the system prompt. **Guardrail carry-over:** if event confidence is low or the
event is early-warning tier, the generated text must label it explicitly ("early signal, single
source") — the channel reader will not see the portal's confidence bar.

**Acceptance Criteria:**
- `EventSummarySchema` enforces the title cap.
- System prompt encodes tone, prefix-ban, and the low-confidence labelling rule.

**Verification:**
- Schema unit test (over-long title rejected).
- Prompt-contract test with a stubbed `SchemaCaller` asserting the constraints are in the system
  prompt.

**Dependencies:** None (parallel with Tasks 1–2)

**Files Likely Touched:**
- `src/llm/summarizer.ts`
- `src/llm/schemas.ts`
- `tests/summarizer.test.ts`

**Estimated Scope:** Small

### Task 4: Summary Stage + Runner Wiring

**Status:** Pending.

**Description:** New pipeline stage selecting events with `llm_summary IS NULL OR summary_stale`,
calling `summarizeEvent()` with the event's grouped articles, persisting via `saveLlmSummary()`,
clearing the flag, and writing an `llm_audit_logs` row (`task_name = 'event_summary'`). Wire into
the LangGraph runner **after classification rollup** — ordering is deliberate: the summarizer's
severity/urgency/confidence write is the last word, superseding both the mechanical draft and
classification-era values (this fixes the mechanical-severity weakness). On LLM failure: leave
the draft title in place, record a failed audit row, stay independently retryable per the
per-stage state-machine convention. Batch cap per run; add an individual stage command
(`summarize:events`) matching the other stages.

**Acceptance Criteria:**
- Events without `llm_summary` get one on the next run; already-summarized, non-stale events are
  skipped.
- Stale events are regenerated and the flag cleared.
- LLM failure never blocks the pipeline and never leaves an empty title.
- Audit rows written for success and failure.

**Verification:**
- Unit tests with a stubbed `SchemaCaller` covering: generate-once, skip, regenerate-on-stale,
  failure fallback.
- `npm run pipeline:run` against the local test source; inspect `cyber_events` rows.

**Dependencies:** Tasks 1, 2, 3

**Files Likely Touched:**
- `src/pipeline/summary-stage.ts` (new)
- `src/pipeline/runner.ts`
- `src/db/repositories/event.repository.ts`
- `package.json` (stage command)
- `tests/summary-stage.test.ts` (new)

**Estimated Scope:** Medium

### Checkpoint: Pipeline

- [ ] `npm run pipeline:run` produces LLM titles/summaries on new events; draft titles survive
      LLM outages.
- [ ] Material update → regeneration; new source → no regeneration (test-proven).
- [ ] `llm_audit_logs` has `event_summary` rows.
- [ ] `npm run check` + `npm test` green.

---

## Phase 2: Portal Data Layer

### Task 5: Events List Query Changes

**Status:** Pending.

**Description:** In the events **list** query (`loadEventsOverview`): add `affected_products`
(today detail-only), add `hasLlmSummary` derived from `llm_summary IS NOT NULL`, and drop `cves`
from the list response. Detail query unchanged.

**Acceptance Criteria:**
- List API returns products and `hasLlmSummary`; no `cves` field.
- Existing filters/sorts (severity, multi-source, sources/recent/severity sort) unaffected.

**Verification:**
- Existing portal API tests updated; `curl` the endpoint against local data.

**Dependencies:** None (renders fallback titles until Phase 1 lands; merge together regardless)

**Files Likely Touched:**
- `src/portal/events-portal.ts`
- `tests/events-portal.test.ts` (or equivalent)

**Estimated Scope:** Small

---

## Phase 3: Portal UI

### Task 6: Six-Column Events Table

**Status:** Pending.

**Description:** Rework the events table to:

| Description | Vendor / Product | Severity | Confidence | Sources | First seen · Last update |
|---|---|---|---|---|---|

- Description = stored `event_title`; muted styling or small marker when `hasLlmSummary` is false
  so mechanically-titled events are distinguishable.
- Vendor/product chips; multi-vendor renders primary + "+N".
- Severity badge gains `critical`/`low` colour classes (the summarizer can now produce them; the
  mechanical draft never did).
- Combined time column: relative pair, absolute UTC in the `title` attribute; sorts unchanged.
- CVE column removed.

**Acceptance Criteria:**
- Six columns render with real data; chips overflow correctly on multi-vendor events;
  fallback-titled events visibly distinct; no CVE column.

**Verification:**
- Preview-driven check (screenshot + DOM inspection) with at least one multi-vendor event and one
  null-`llm_summary` event in local data.

**Dependencies:** Task 5

**Files Likely Touched:**
- `src/portal/articles-portal-view.ts`

**Estimated Scope:** Medium

### Task 7: Detail Pane Leads with the Channel Payload

**Status:** Pending.

**Description:** Event detail pane leads with the stored title + summary rendered exactly as the
future channel post would read (title, summary, low-confidence label when present), followed by
the existing fields: urgency, CVEs, attack types, per-source timeline.

**Acceptance Criteria:**
- Detail shows the payload block first; all previously shown fields still present.

**Verification:**
- Preview check on an event with an LLM summary and one without.

**Dependencies:** Tasks 5, 6

**Files Likely Touched:**
- `src/portal/articles-portal-view.ts`

**Estimated Scope:** Small

### Checkpoint: Portal

- [ ] List renders six columns from stored data only (zero LLM calls in the portal process).
- [ ] Multi-vendor chips, fallback-title styling, relative time column verified in preview.
- [ ] Detail pane previews the channel payload verbatim.

---

## Phase 4: Verification and Merge

### Task 8: Guardrail and Regression Tests

**Status:** Pending.

**Description:** Consolidated test pass: low-confidence/early-warning events produce labelled
text (assert on the schema output contract with a stubbed caller); stage trigger rules
(material-update regenerates, new-source does not); portal API shape.

**Acceptance Criteria:**
- All new behaviour test-covered; full suite green.

**Verification:**
- `npm run check` + `npm test`

**Dependencies:** Tasks 1–7

**Files Likely Touched:**
- `tests/*`

**Estimated Scope:** Small

### Task 9: Code Review Doc + Merge

**Status:** Pending.

**Description:** Per the development workflow: feature branch (`feat/event-summary-stage` or
similar), code review document in `docs/code-reviews/` (`YYYY-MM-DD-event-summary-portal.md`),
merge only after `npm run check` and `npm test` pass. Update
`docs/design/ui-and-dashboards.md` (portal section) to describe the new events table.

**Acceptance Criteria:**
- Review doc covers what changed and why, risks/behaviour changes, test evidence, explicit
  verdict.

**Verification:**
- Workflow steps completed on the branch.

**Dependencies:** Task 8

**Files Likely Touched:**
- `docs/code-reviews/*`
- `docs/design/ui-and-dashboards.md`
- `docs/README.md`

**Estimated Scope:** Small

### Checkpoint: Done

- [ ] Pipeline generates and stores titles/summaries; portal reads them; channel payload is
      preview-able in the detail pane.
- [ ] Review doc merged with the change.

---

## Risks

| Risk | Mitigation |
|---|---|
| Summarizer overwrites classification-derived severity with worse values | Stage ordering is explicit (last word by design); audit rows keep prior values recoverable |
| Title churn erodes operator recognition | Regenerate only on `summary_stale` (material updates); audit log preserves every prior generation |
| LLM cost/latency per pipeline run | Per-event not per-article; batch cap per run; stage retryable so a slow run degrades to "draft titles a little longer" |
| `rss_only` events have thin input (no clean text) | `summarizeEvent` already falls back through rssSummary/title per article; low-confidence labelling requirement covers the quality floor |
| Channel payload violates "label early warnings clearly" guardrail | Explicit prompt constraint + dedicated test; not left to prompt vibes |
