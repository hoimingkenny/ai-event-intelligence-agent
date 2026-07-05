# Evaluation Plan

Evaluate the system as a cyber triage subsystem, not as a chatbot.

## Production Self-Evaluation (implemented, always on)

Three metrics run in production without human labels:

- **`rss_recall`** — per-article extraction ground truth: word recall of the RSS summary against extracted text. Written at extraction time; `null` for rss-only extractions so the pipeline cannot grade its own homework.
- **Extraction drift** (`npm run drift:check`, exit 2 on drift) — rolling median recall/quality + failure rate per source (window 20, min 5 samples). A site redesign surfaces the same day.
- **Alert latency SLO** (`npm run latency:check`, exit 2 on violation) — publication→alert p50/p90 against the 2-hour window. This is the product metric for an early-warning system.

Both watchdogs also run inside every pipeline sweep.

## Fixture Regression (implemented)

Real article HTML saved via `npm run fixtures:fetch -- <url>`; `npm run fixtures:review` builds a side-by-side human review page. With a human reference (`.expected.txt`), tests assert word-level recall ≥ 0.8 and precision ≥ 0.6. A deterministic local test source (`npm run test-source:serve`) exercises the full pipeline — grouping-key attach, separate events, ad-cluster removal, cheap-filter rejection — without live data.

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
