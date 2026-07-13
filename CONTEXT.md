# Vendor Threat Watch

AI-assisted cyber early-warning and vendor-impact triage: fresh cyber reports are ingested, filtered, extracted, and grouped into canonical incidents for analyst review.

## Language

**Article**:
A single source report (RSS item or imported URL) progressing through the pipeline.
_Avoid_: Document, post, story (when meaning a pipeline record)

**Canonical event**:
The system's single incident record that one or more articles may attach to.
_Avoid_: Cluster, incident ticket, alert (alert is a downstream notification)

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
