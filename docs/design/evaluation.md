# Evaluation Plan

Evaluate the system as a cyber triage subsystem, not as a chatbot.

## Item-Level Metrics

- Freshness: is the item from last 2 hours, last 6 hours, or today?
- Cyber relevance: is it a real cyber event or generic commentary?
- Vendor/product match: does it affect a monitored vendor/product?
- Source quality: official advisory, CERT, threat research, news, social signal.
- Novelty: new event, duplicate, or material update?
- Actionability: does it suggest a concrete analyst action?

## Run-Level Metrics

```text
precision = useful alerts / all alerts
recall = found important events / known important events
duplicate leakage = duplicate alerts / all alerts
latency = first_seen_by_agent - published_at
```

The implemented evaluator uses `data/labelled-eval-set.json` and reports:

- `duplicate_reduction_rate`
- `event_grouping_precision`
- `classification_precision`
- `false_positive_rate`
- `llm_call_reduction_rate`
- `extraction_success_rate`
- `median_source_to_notification_latency_seconds`

Run it locally with:

```bash
npm run eval
```

Persist a run to Postgres after migrations are applied:

```bash
npm run eval -- --persist
```

## MVP Acceptance Target

```text
Precision >= 80%
Duplicate alert leakage <= 10%
High-severity event discovery latency <= 30 minutes after search visibility
Every alert has source, reason, vendor match, and recommended action
```
