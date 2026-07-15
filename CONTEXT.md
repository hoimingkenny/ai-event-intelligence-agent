# Vendor Threat Watch

AI-assisted cyber early-warning and vendor-impact triage: fresh cyber reports are ingested, filtered, extracted, and grouped into canonical incidents for analyst review.

## Language

**Article**:
A single source report (RSS item or imported URL) progressing through the pipeline.
_Avoid_: Document, post, story (when meaning a pipeline record)

**Canonical event**:
The system's single incident record that one or more articles may attach to.
_Avoid_: Cluster, incident ticket, alert (alert is a downstream notification)

**Publication status**:
Whether a canonical event is visible on the public portal: `draft` (not public) or `approved` (public). Independent of incident lifecycle status such as open/closed.
_Avoid_: event status, published (when used as a synonym for the event itself), visibility flag

**Event approval**:
The human action that sets a canonical event's publication status to `approved`. Requires at least one affected vendor or product. Makes the event (and eligible articles) visible on the public catalogue.
_Avoid_: Human review verdict (post-hoc correct/incorrect scoring of pipeline output), eval label

**Event unpublish**:
The human action that returns a canonical event's publication status from `approved` to `draft`.
_Avoid_: Delete, close, suppress alert

**Grouping**:
Deciding whether an article attaches to an existing canonical event or creates a new one.
_Avoid_: Dedup, merge (dedup is article-identity; grouping is incident-identity)

**Article deduplication**:
Deciding whether an article is the same *article* again (hash/title), so it should not be reprocessed.
_Avoid_: Grouping, event merge

**Article embedding**:
The vector stored on an article, produced from that article's embeddable text.
_Avoid_: Event embedding (different record)

**Event embedding**:
The vector stored on a canonical event and used as the search target when grouping later articles.
_Avoid_: Article embedding

**Vector provenance**:
Metadata recording which embedding model and dimensions produced a stored vector, and when.
_Avoid_: Audit log (broader); config alone (not persisted on the row)

**Embedding lifecycle**:
The owned process that produces, records provenance for, retries, and invalidates article and event embeddings.
_Avoid_: Embedding stage (one pipeline step); provider client (transport only)

**Unembedded article**:
An article that does not yet have a usable, provenance-eligible embedding for similarity.
_Avoid_: Failed article (failure is one cause; awaiting embed is another)

**Grouping pair label**:
A derived or overridden judgement on two articles for embedding-threshold calibration: `same_event` / `different_event` are derived from gold incidents; only `uncertain` overrides are hand-persisted.
_Avoid_: Cluster label, duplicate label, grouping verdict (verdict is a per-article review of pipeline output)

**Gold incident**:
A human-curated set of articles known to describe one real-world incident. Within-basket pairs derive as same_event; cross-basket pairs derive as different_event. Article URLs must not appear in more than one gold incident.
_Avoid_: Cluster, canonical event (canonical event is the system's record; a gold incident is evaluation ground truth)

**Gold incident assist**:
An eval-only LLM draft that helps a human create a gold incident: per-article body briefs, a same-event recommendation, and a suggested name. It never writes gold without an explicit human Accept.
_Avoid_: Auto-label, LLM gold, grouping assist (ambiguous with production grouping)

**Needs triage**:
The analyst queue of articles that are not yet attached to any approved canonical event. An article may already sit on a draft and still need triage until publication status is approved.
_Avoid_: Unprocessed, pending extraction, human review queue

**Article peek**:
A slide-over drawer on the needs-triage list that shows a short excerpt, cheap-filter signals, extracted entities, and a compact LLM digest so the analyst can decide whether to open the workspace article.
_Avoid_: Human review, quick review, workspace human review

**Workspace article**:
The analyst-only full article page under the workspace (`/workspace/articles/[id]`) with extracted text, full LLM classification, signal blocks, and pipeline meta — separate from the public catalogue article page.
_Avoid_: Public article page, human review case

**Human review**:
Post-hoc analyst judgements on pipeline output (relevance, vendor impact, grouping, alerts, etc.) captured in the review dashboard for quality and eval — not the act of putting an article onto a canonical event.
_Avoid_: Event approval, article peek, needs triage

**Feed**:
A configured RSS source the pipeline may ingest from, with active/inactive state and source metadata.
_Avoid_: Source (ambiguous with article provenance), RSS config file

**Monitored vendor product**:
A vendor+product pair (with aliases, criticality, and news volume) the system watches for impact; the live set is the monitored inventory.
_Avoid_: Vendor (vendor alone), inventory item (vague), seed vendor

**News volume**:
How chatty a monitored vendor product is in security coverage for cheap-filter strictness: `quiet` or `noisy`. Not RSS fetch volume.
_Avoid_: Feed volume, article count, traffic

**Workspace Config**:
The analyst Workspace area for live operational settings (feeds and monitored inventory), separate from editorial queues.
_Avoid_: Settings, admin, eval inventory tab

**Filter re-queue**:
The analyst action that returns a specific ignored article to `NEW` so the cheap filter can run again against the current inventory. Not a bulk historical rescan.
_Avoid_: Reprocess, rescan, re-filter all, manual articles (eval-only imports)
