# Limitations

Known limits of the current implementation, ordered roughly by impact on the early-warning mission.

- **Sources are secondary.** Current feeds are security journalism, which lags the primary signal (vendor PSIRT advisories, CISA KEV, CERTs, researcher/exploit chatter) by hours. Tier-0/1 source onboarding is the largest untapped speed gain.
- **`trust_level` is stored on feeds but not yet used in any decision** — a single authoritative source should clear the confirmed gate alone; it currently cannot.
- **Batch sweeps, not push-through.** Pipeline latency is bounded by sweep cadence × stage count. BullMQ job payloads carry article IDs but stages ignore them; per-article push-through is the follow-up that collapses queue latency to seconds.
- **Grouping keys are identities, not aliases.** A CVE arriving after an event was keyed on vendor+attack-type can split the event exactly when it matters most; the embedding rung partially compensates. Key aliasing/merging is planned.
- **Playwright is disabled**, so JavaScript-only publishers fail extraction entirely (accepted for current server-rendered feeds).
- **Embedding thresholds (0.15/0.35) and confidence-rollup weights are unvalidated priors** — tunable against the labelled eval set, not yet tuned.
- **Prompt injection is unaddressed**: untrusted web content flows into LLM prompts. Mitigations exist by construction (no tool access, schema-constrained outputs) but no deliberate hardening or cross-checking of verdicts against deterministic signals yet.
- Entity extraction is deterministic and may miss obscure vendors, products, or threat names; the cheap filter marks misses `IGNORED` terminally, so inventory additions do not re-scan history.
- LLM classification can still misclassify ambiguous articles; never-downgrade severity semantics mean one bad early classification pins an event high until human review.
- `uncertain_need_human_review` exists as a type but has no review queue, UI, or feedback capture; human corrections do not yet feed the eval set.
- No notification channels beyond the database (email/Slack/webhooks are future work); no operations dashboard.
- Latency measurement is publication→alert only; per-stage breakdown (where time is actually spent) is not yet recorded.
