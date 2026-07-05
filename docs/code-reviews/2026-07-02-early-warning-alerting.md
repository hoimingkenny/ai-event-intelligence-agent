# Code Review: Two-tier early-warning alerting + newest-first + latency SLO

- **Branch:** `feat/early-warning-alerting` → `main`
- **Date:** 2026-07-02
- **Reviewer:** Claude

## Summary of change

Resolves the central design contradiction found in the early-warning review: the alert gate (confidence ≥ 0.75, severity ≥ medium, P1/P2) structurally suppressed exactly the low-confidence fresh signals an early-warning product exists to surface.

`decideAlert` is now a two-tier policy: **early_warning** — fresh event (first_seen within `EARLY_WARNING_WINDOW_HOURS`, default 24) touching a monitored vendor alerts immediately, explicitly labeled unconfirmed; **confirmed** — the original strict gate. Events that fired an early warning are *upgraded* when they cross the confirmed gate, and material updates (comparator flag from the grouping ladder) bypass the recent-alert suppression window — implementing the "do not suppress same-event material updates" guardrail, which was previously violated.

Also: work queues now process **newest first** (`published_at DESC` in `listByProcessingStatus` — breaking news no longer queues behind backlog), and time-to-alert (publication → alert) is now measured: `src/monitoring/alert-latency.ts` computes p50/p90 against a 2h SLO (`ALERT_LATENCY_SLO_HOURS`), runs after every alert stage and standalone via `npm run latency:check` (exit 2 on violation).

## Behaviour changes

- **Alert volume will increase substantially**: fresh vendor-matched events below the confirmed gate now alert (labeled `early_warning`) instead of being suppressed. This is the intent. Tune `EARLY_WARNING_WINDOW_HOURS` down if too noisy.
- **Migration required** (`006_alert_tiers.sql`): `alerts.alert_tier` + `(event_id, created_at DESC)` index.
- `AlertRepository.hasRecentAlert` replaced by `getRecentAlert` (returns tier + timestamp); alert stage passes material-update state into the decision.
- Suppression reasons changed: `new_vendor_impact_event` → `confirmed_vendor_impact_event`; new reasons `early_warning_unconfirmed_signal`, `upgraded_to_confirmed`, `material_update_bypasses_suppression`, `stale_event_below_confirmed_gate`.
- Unknown event age is treated as fresh (fail toward labeled signal, not silence) — deliberate asymmetry, documented in code.
- Work ordering flip is deliberately NOT applied to `findEarlierByContentHash`/`findRecentByTitleHash` — those find the *original* article and keep ASC semantics.

## Risks and concerns

- **Early-warning noise**: every fresh vendor-matched event alerts once. Acceptable for a triage tool whose users asked for news-desk behaviour; the tier label lets consumers filter. Follow-up lever: require a minimum severity for the early tier if volume proves unmanageable.
- **Latency metric approximates**: publication → alert includes publisher timestamp accuracy and feed polling delay. That is the honest end-to-end number for the 2h window, but per-stage breakdown (where time is actually spent) remains a follow-up.
- **Newest-first starvation**: under sustained backlog, oldest articles could starve. Accepted: for early warning, old news is the correct thing to sacrifice; the sweep runner still drains everything eventually.

## Test evidence

- `npm run check` clean; vitest **105 passed** / 4 skipped (3 pre-existing MiniMax network failures only).
- 13 new tests: early tier below the old gate (the previously-suppressed case now alerts), unknown-age-as-fresh, stale suppression, upgrade path, no-upgrade below gate, material-update bypass at both tiers, repeat suppression; latency p50/p90/SLO/empty/min-sample cases.
- One existing workers test updated (`toMatchObject`) for the additive stage counters.

## Follow-ups

Per-article push-through workers (queue latency dominates now that ordering is fixed); grouping-key aliases (CVE arriving late splits events); tier-0/1 source onboarding (Mastodon/PSIRT/KEV) with `trust_level` wired into confidence; per-stage latency breakdown.

## Verdict

**Approve.** The change makes the system's behaviour match its stated purpose — surface early signals labeled, confirm later, never suppress material updates — and adds the SLO instrumentation to prove it.
