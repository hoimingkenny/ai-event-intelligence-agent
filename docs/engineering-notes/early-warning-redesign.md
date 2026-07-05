# The Gate That Suppressed the Product: Redesigning for Early Warning

How a domain re-review — "CVE is too slow as a first signal; think like people trading news" — exposed that the system was structurally incapable of its stated mission, and what changed. Nothing was broken in the conventional sense: every test passed. The bugs were in the mismatch between stated purpose and implemented policy.

## 1. The reframing

The system's mission is a 2-hour impact-review window. The original design treated CVEs as the anchor signal and confirmation as a virtue. But CVE assignment lags first public signal by hours to days, and in an early-warning context signal value decays like news value for a trader: being confirmed and second is worth less than being labeled-uncertain and first. Re-deriving the design from the analyst's actual decision cadence surfaced five findings, in descending severity.

## 2. Finding: the alert gate suppressed exactly the mission-critical signals

The single alert gate required severity ≥ medium, urgency P1/P2, **and confidence ≥ 0.75**. Early signals are low-confidence *by nature* — one source, no CVE, unconfirmed. The project's own guardrail said "label low-confidence early-warning signals clearly"; the implementation silently suppressed them. Precision policy, recall mission.

**Fix — two-tier alerting** (`decideAlert`): a fresh event (≤ `EARLY_WARNING_WINDOW_HOURS`) touching a monitored vendor alerts immediately as `early_warning`, explicitly labeled unconfirmed; the strict gate applies to the `confirmed` tier, which *upgrades* an existing early warning rather than duplicating it. Material updates always bypass the suppression window (implementing a previously violated guardrail). One deliberate asymmetry: unknown event age counts as fresh — the policy fails toward a labeled signal, never toward silence. The accepted cost is alert volume; the tier label is the consumer's filter.

## 3. Finding: FIFO queues put breaking news behind backlog

Work queues processed oldest-fetched first. Under any backlog, the newest article — the only one with trading value — waited longest.

**Fix**: newest-published-first ordering in `listByProcessingStatus`. Deliberate exception: original-detection queries (content/title hash) keep oldest-first semantics because their job is finding the *original*. Accepted trade-off: under sustained backlog, stale articles can starve — for early warning, stale news is the correct sacrifice, and sweeps still drain eventually.

## 4. Finding: the product metric was unmeasured

Publication→alert latency — the number the 2-hour window is *about* — was recorded nowhere. Extraction quality had a watchdog; the mission SLA had none.

**Fix**: `src/monitoring/alert-latency.ts` computes p50/p90 of `alert.created_at − min(published_at)` per sent alert against a 2h SLO, runs inside every pipeline sweep and standalone (`npm run latency:check`, exit 2 on violation). The same philosophy as extraction drift: make degradation observable before optimizing it. Honest caveat: this measures end-to-end including feed-polling delay — which is exactly the number that matters, but per-stage breakdown remains follow-up work.

## 5. Findings deferred, deliberately

Two structural issues were identified and scoped but not fixed in the same change, because each is its own risk surface:

- **CVE-first grouping keys are backwards for early warning**: an event keyed on `vendor::attack-type` at hour 0 splits when hour-6 coverage arrives keyed on `cve:...`. The plan is key *aliases* — an event accumulates keys; a late CVE merges into the open vendor-keyed event instead of spawning a sibling. The embedding rung partially compensates meanwhile.
- **News feeds are secondary sources**: journalism lags the primary signal (vendor PSIRTs, CISA KEV, CERTs, researcher chatter) by hours. The tier model — chatter (minutes, low trust, consumed as *velocity*: distinct authors per window, not content), authoritative (hours, high trust, single source clears the confirmed gate), journalism (corroborator) — maps directly onto the two alert tiers. `feeds.trust_level` exists and is the wiring point.

## 6. The transferable lesson

Policy thresholds encode a value judgment — precision vs recall, confirmation vs speed. The dangerous failure mode is writing that judgment once, implicitly, inside a gate condition, and never re-deriving it from what the user actually does with the output. Here the user's decision cadence was "trade the news"; the gate's was "publish a journal." Both are defensible policies — for different products. Reviews that only ask "does the code do what it says?" cannot catch this class of defect; you have to ask "does what it says serve the mission?"
