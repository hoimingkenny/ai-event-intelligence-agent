# Gold incident assist is advisory, not gold authority

Grouping eval may offer an LLM **gold incident assist** (briefs + same-event recommendation + suggested name) so a human can judge long article bodies without reading every word. The human Accept creates the gold incident; the model never writes gold on its own, and assist output is not persisted as ground truth.

We use a **dedicated Assist prompt**, not the production `compareArticleToEvent` comparator, so eval UX cannot silently change or be confused with live grouping. v1 assists on 2–5 already-extracted DB articles (`cleanText` required); paste-URL ingest, add-to-existing basket, and assist-transcript persistence are deferred.

## Considered Options

- **LLM writes gold labels** — rejected: circular eval (model grades itself / contaminates grouping pair derivation).
- **Reuse production event comparator in a loop** — rejected: wrong shape (article↔event attach), weak briefs, risk of “fixing” production when Assist is wrong.
- **Title + RSS only** — rejected: human can already read those; Assist’s value is compressing article bodies.
