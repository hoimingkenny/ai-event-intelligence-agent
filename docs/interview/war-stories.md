# War Stories

Debugging stories in tell-able form. Structure each as: situation → investigation → root cause → fix → lesson. The lesson is what interviewers remember.

## 1. The disappearing article (linkedom silent data loss)

**Situation**: Readability parsed an article successfully, but the final cleaned text came out empty. No error anywhere.
**Investigation**: bisection by isolation — same HTML, same library, wrapper code stripped one layer at a time. Raw Readability worked; my pipeline around it didn't. Narrowed to the re-parse step of Readability's output.
**Root cause**: linkedom, a lightweight DOM implementation, silently drops child nodes when given a bare `<body>...</body>` fragment instead of a complete HTML document. No exception — the body just parses empty.
**Fix**: wrap the fragment as a full document. Documented as an invariant in CLAUDE.md so no one reintroduces it.
**Lesson**: lightweight reimplementations of browser APIs have unspecified error-recovery on nonconforming input, and silent failures are the worst class. Defence: assert non-empty intermediate results at every pipeline step, not just validate final output.

## 2. The 500-character rejection (library defaults vs your domain)

**Situation**: structurally normal test articles returned `null` from Readability; longer articles with identical structure parsed fine.
**Root cause**: Readability's `charThreshold` default of 500 — tuned for general web articles. Security advisories (CISA especially) are frequently shorter, so the extractor rejected exactly the highest-value content in my domain.
**Fix**: threshold 250 for this domain.
**Lesson**: third-party defaults encode someone else's use case. Anything that filters by size, time, or confidence deserves a domain-specific review.

## 3. The ad that had no ad class (structural signals beat blacklists)

**Situation**: a native ad ("Test every layer before attackers do…" — a Picus whitepaper pitch) leaked into extracted article text from BleepingComputer. Plain paragraphs, no "ad" class, embedded inside the article container. Text-level filtering can't distinguish ad copy from article prose.
**Investigation**: fetched the real page and looked at what the ad *had* to do rather than what it happened to look like: the same external campaign URL appeared three times in a tight cluster — linked banner image, fully-linked headline, "Get the whitepaper" CTA.
**Fix**: normalize link targets (strip utm/query), detect repeated offsite URLs with CTA/heading/image-link signals, remove the sibling span between first and last occurrence. Guardrails against false removal: max span 8 blocks / 800 chars, same-site exemption, and a dedicated test proving legitimate double-citation of an NVD link survives.
**Lesson**: target what the adversary can't cheaply change. Class names are surface features; repeating the campaign link is structural to how ads work. Same reasoning as preferring TTPs over IOCs in threat detection — this framing lands especially well in security-adjacent interviews.

## 4. The metric that watches the system (drift detection design)

**Situation**: extraction rules inevitably rot when sites redesign — and nobody notices until alert quality has quietly degraded for weeks.
**Insight**: every article ships with free ground truth — the RSS summary is drawn from the article body, so word recall of summary-vs-extracted-text is a per-article quality score with zero human labelling and zero LLM cost. Healthy ~0.9+; a broken selector collapses it.
**Design**: rolling median per source (outlier-immune), minimum sample floor (no false alarms from quiet feeds), thresholds that flag the same day a redesign lands. Gaming protection: the metric is null when the RSS summary itself was used as content — otherwise the pipeline would grade its own homework at a perfect 1.0.
**Lesson**: before automating repair (LLM re-learning rules), make degradation observable and repair verifiable. Measurement first, automation second.

## 5. The dead code that was the product (honest self-review)

**Situation**: reviewing my own pipeline, I found the semantic dedup path was never invoked (embeddings computed, vector never passed), the LLM event comparator existed but had no caller, and event matching used generated title strings.
**Fix**: the grouping ladder — key match → embedding bands → LLM in the uncertain band — with pure decision functions separated from I/O so the entire ladder is unit-testable without a database. Also caught an `isPrimarySource` bug where one batch flag marked every subsequent attach as primary.
**Lesson**: "wired in and measured" is the bar, not "implemented". Code that exists but isn't in the decision path is worse than absent — it gives false confidence. This story shows you can review a system honestly, including your own.

## 6. The gate that suppressed the product (requirements re-review)

**Situation**: the system's stated mission was a 2-hour impact-review window, but a domain re-review ("CVE is too slow as a first signal — think like people trading news") exposed a contradiction: the alert gate required confidence ≥ 0.75, severity ≥ medium, P1/P2. Early signals are low-confidence *by nature* — one source, no CVE yet. The guardrail said "label low-confidence early-warning signals clearly"; the code silently suppressed them. The system was structurally incapable of its own mission.
**Also found in the same review**: work queues were FIFO by fetch time (breaking news queued behind backlog), grouping keys were CVE-first (but CVEs arrive hours-to-days after first signal, splitting events exactly when it matters), and the product metric — publication→alert latency — was completely unmeasured.
**Fix**: two-tier alerting (`early_warning` fires immediately, labeled unconfirmed; `confirmed` upgrades it when the strict gate is crossed; material updates bypass suppression), newest-first ordering, and a latency SLO watchdog (p90 vs 2h) running in every pipeline sweep.
**Lesson**: the most dangerous bugs aren't in the code, they're in the mismatch between stated purpose and implemented policy. Nothing was "broken" — every test passed — but the gate optimized for precision when the mission demanded labeled recall. Re-derive the policy from the user's actual decision cadence (here: news-trading speed), not from what feels responsible.

## 7. Reviewing someone else's code honestly (the review dashboard)

**Situation**: a human-review dashboard was added by another contributor (Codex). Reviewing it, the fundamentals were solid — parameterized SQL, zod-validated submissions, escaped rendering, localhost binding.
**What I flagged beyond its own review doc**: cases loaded by recency, so scarce review time went to articles the pipeline handled confidently (fix: attention-first queue — the code already computed the flag but only displayed it); and `UNIQUE(article_id)` upsert meant re-reviews overwrote history, destroying the ability to measure whether the pipeline improved after a fix (fix: append-only verdicts, latest-per-article reads).
**Lesson**: review for what the data model *forecloses*, not just what the code does today. The upsert wasn't a bug — it was a schema decision that silently deleted a future capability. That class of issue never shows up in tests.
