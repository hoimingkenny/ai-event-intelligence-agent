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

## Cheap-Filter Evaluation (implemented)

`npm run eval:cheap-filter` evaluates only the cheap-filter stage against `eval/datasets/cheap-filter-eval.jsonl` and writes reports to `eval/reports/cheap-filter-report.json` and `eval/reports/cheap-filter-report.md`.

This evaluator treats the cheap filter as a recall-protection layer, not a final relevance classifier:

- `KEEP` and `MAYBE_KEEP` count as passing the cheap filter.
- `DROP` means the article was filtered out before extraction.
- `CRITICAL_RELEVANT` articles must receive `KEEP`; `MAYBE_KEEP` is a priority failure.
- `RELEVANT` articles must receive `KEEP` or `MAYBE_KEEP`; `DROP` is a false negative.

The report shows critical recall, relevant recall, false-negative rate, critical miss rate, pass-through rate, KEEP/MAYBE_KEEP rates, irrelevant pass rate, reason-code coverage, a confusion matrix, false negatives, critical priority failures, failure buckets, and tuning recommendations.

The starter dataset is intentionally small and schema-valid. It should grow from human-reviewed dashboard cases, especially vague RSS articles where the important signal appears only after extraction.

## Human Review Dashboard (implemented)

`npm run review:dashboard` starts a local dashboard at `http://127.0.0.1:4321` backed by the current Postgres pipeline state. It is the bridge between automated metrics and analyst trust: each recent article is shown with RSS summary, extracted text, detected entities, linked event, grouping relationship, confidence/severity/urgency, alert decision, and related LLM audit entries.

The dashboard has two roles:

1. **Monitoring surface** — expose pipeline and AI decisions so a human can notice wrong tags, missing entities, bad grouping, incorrect LLM classification, or questionable alerting.
2. **Quality-control loop** — turn those human corrections into auditable review data that can later drive evaluation, threshold tuning, prompt changes, vendor-alias updates, and model comparisons.

The design principle is:

```text
Every AI/pipeline decision must be explainable, reviewable, and correctable.
```

The dashboard is therefore not only an alert-review page. It should show the full article lifecycle, because quality failures can happen before an alert exists:

- cheap filter ignored an article that should continue
- extraction is pending, failed, or low quality
- entity detection tagged the wrong vendor/product
- LLM classification assigned the wrong relevance, role, severity, or urgency
- event grouping attached the article to the wrong incident
- alert policy fired, suppressed, or tiered the event incorrectly

The dashboard lets a human save verdicts for:

- cyber relevance
- vendor/product impact
- LLM classification output
- event grouping
- alert decision

Verdicts are stored in `human_review_verdicts` so the judgement is auditable and can later be exported into `data/labelled-eval-set.json`.

LLM output is only present for articles that reach the classification stage. Items still in `IGNORED`, `EXTRACTION_PENDING`, or earlier states are pipeline/status review cases, not LLM quality cases; use the dashboard's `LLM output` filter to review only cases with recorded model output.

The dashboard highlights cases that need human attention:

- extraction failures or low extraction quality
- `uncertain_need_human_review` grouping relationships
- low event confidence
- unsuppressed `early_warning` alerts

For a static snapshot, `npm run review:report` still generates `review/human-dashboard/index.html`.

### Quality-Control Loop

Human review should improve the system through measured engineering changes, not silent self-training:

```text
pipeline output
  → human finds a wrong tag/decision
  → structured verdict or correction is stored
  → reviewed cases become evaluation evidence
  → failure patterns are measured
  → rules/prompts/thresholds/models are changed deliberately
  → evaluation proves whether quality improved
```

This keeps the LLM out of the system-of-record role. Human judgement becomes evaluation data; engineers use that data to improve deterministic extraction, entity detection, LLM prompts, event grouping thresholds, alert policy, source trust, and model selection.

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
