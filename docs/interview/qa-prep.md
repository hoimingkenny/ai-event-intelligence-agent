# Q&A Prep

Anticipated questions with answer outlines. Rehearse the reasoning, not the wording.

## "How do you know your agent works?"

Four layers: (1) labelled eval set run as a suite; (2) free per-article ground truth — RSS-summary word recall scores every extraction in production; (3) watchdogs — extraction drift (rolling medians per source) and a publication→alert latency SLO (p90 vs the 2h window), both alarming, not assuming; (4) human verdicts — a review dashboard captures per-dimension judgments (relevance/vendor impact/classification/grouping/alert) append-only, attention-first queue. Punchline: the system detects its own breakage the same day, and human review tells me which stage is weak, not just that something was wrong.

## "How do you control LLM costs?"

Cost ladder by architecture: regex/keyword filter → hashes → grouping key → embeddings → LLM only in the uncertain cosine band (0.15–0.35). The LLM sees only genuinely ambiguous pairs. Every call is audit-logged, so cost per decision is queryable. If asked about scaling: batch the uncertain band, cache enrichment by CVE ID, per-event token budgets enforced in code.

## "Why didn't you use multi-agent / would you?"

Not reflexively — agents must differ by role, tools, or stance, and every crew needs a deterministic referee. Legitimate fits in this system: enrichment fan-out (CVE/advisory/exploit-intel collectors + a synthesizer with a different job — judgment vs retrieval), proposer/validator split for self-healing extraction (an agent must not grade its own homework), generator–critic on alerts (adversarial stance against the most expensive failure mode, false alerts). What I avoided: agents debating what one schema-constrained call can decide — that spends tokens restructuring the same output.

## "What about prompt injection?"

Honest answer: it's my known biggest gap, and I can describe the exact threat — the pipeline feeds untrusted web content to LLMs, and an attacker suppressing classification of their own campaign is the realistic attack. Mitigations planned/partial: content-processing LLMs have zero tool access, outputs are zod-schema-constrained, and LLM verdicts should be cross-checked against deterministic signals (classifier says "not relevant" but the article has a CVE and vendor match → flag, don't trust). Naming your own gaps with a threat model beats claiming completeness.

## "What breaks at 100× volume?"

Sequential per-article awaits become the bottleneck (I/O-bound stages need bounded concurrency); per-status polling needs `FOR UPDATE SKIP LOCKED` claim queries for horizontal workers; the BullMQ path should become per-article push (job carries articleId) instead of batch sweeps; embedding API calls need batching. I can point at each spot in the code — the state machine design already supports the migration.

## "How do you handle LLM failures?"

Per-decision failure semantics, not a global policy. Example: comparator failure creates a separate event rather than merging (splits are recoverable, silent fusion isn't) — fail-open. A classification failure should fail loud (event flagged) rather than silently keeping heuristic severity. Provider outage: the pipeline is async, stages queue and drain later; nothing corrupts.

## "How would you ship a prompt change safely?"

Prompts are versioned in the audit log; the gap I'd close: run the labelled eval set against the new prompt before merge (eval-in-CI), compare metrics, gate on regression. Same discipline as a schema migration — versioned, validated, reversible.

## "Tell me about a hard bug"

Use linkedom silent data loss (war-stories #1) for a debugging-skills question; the native-ad structural signal (#3) for a design-thinking question; drift detection (#4) for a systems-thinking question; the alert gate that suppressed the product (#6) for a requirements/product-judgment question — it's the strongest story because nothing was technically broken.

## "What would you build next?"

Priority-ordered and justified: (1) verdict→eval-set export — human reviews exist but don't yet feed `npm run eval`; closing that loop makes every review session permanent regression protection; (2) analyst copilot agent on LangGraph (read-only tools over the event DB, interrupt-based human confirmation — the StateGraph runner already validated the framework); (3) tier-0/1 sources (Mastodon/PSIRT/CISA KEV) with `trust_level` wired into confidence — the largest untapped speed gain since news feeds are secondary sources; (4) per-article push-through workers. Multi-agent enrichment after those, because it adds capability rather than restructuring existing capability.

## "Why these technologies?"

pgvector over a dedicated vector DB: dedup candidates need joining against relational state (articles, events, status) — one system of truth, no sync problem, HNSW is plenty at this scale. TypeScript: type-safe schemas end-to-end (zod validates LLM output into typed domain objects). MiniMax: deliberately provider-agnostic client abstraction — swapping providers is a config change, and I'd A/B on the eval set before switching. LangGraph: adopted where a framework earns its keep (graph orchestration now, copilot's tool loop + interrupts next) and explicitly kept out of pipeline stages — "the framework is a client of the pipeline's state, never its owner."

## "How do humans fit into your agent system?"

Three roles, all implemented or scoped: (1) quality judges — the review dashboard captures per-dimension verdicts, append-only so re-reviews after a fix measure improvement; the queue is attention-first, spending scarce labels where the pipeline is least sure; (2) escalation target — `uncertain_need_human_review` is a first-class dedup outcome, and the copilot design uses LangGraph interrupts for anything that mutates state; (3) label source — verdicts are designed to flow into the eval set (the open loop I'd close next). The principle: humans aren't a fallback for a broken agent, they're the calibration instrument.

## Behavioural: "biggest weakness of the project?"

Pick honestly and show the fix is understood: (1) prompt injection hardening not yet implemented — threat model articulated above; (2) thresholds are priors, not validated against the labelled set yet; (3) single-developer review process — mitigated by written pre-merge review docs, but no second human. Naming real weaknesses with mitigation plans reads as senior; claiming none reads as junior.
