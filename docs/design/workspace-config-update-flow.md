# Workspace Config — update flow

Record of the agreed **before/after** behaviour for Config hub Feeds and Inventory edits. Parent: [PRD #34](https://github.com/hoimingkenny/ai-event-intelligence-agent/issues/34). Tickets: #35–#39.

## Mental model

| Layer | When it updates |
|--------|------------------|
| **Postgres** | On Save (add / edit / soft-deactivate) |
| **Config hub & lists** | Immediately on refresh/navigation (they read DB) |
| **Pipeline (ingest / filter / entity)** | **Next run only** — no trigger from Save |
| **Old `IGNORED` articles** | **Unchanged** unless the analyst uses **filter re-queue** on that article |

Soft-deactivate means “remove from live watching,” not hard delete. Rows stay; active flips off.

Save must not start ingest or re-filter from Workspace (ADR-0003: web and pipeline are separate processes).

## Feeds

**Before add** — Hub “active feeds” = N. List shows existing rows. Ingest only pulls `is_active = true`.

**After add**

- DB: new feed row (`source_type = rss`, name / URL / trust / active).
- Hub/list: count +1 if active; new row visible.
- Pipeline: nothing until the **next ingest**. No articles from that URL yet.

**After edit** (name, URL, trust, active)

- DB + Config UI update immediately.
- Next ingest uses the new URL / active / trust.
- Already-fetched articles keep their old `feed_id` / content; edit does not rewrite history.

**After soft-deactivate**

- Hub active count −1; row still listed as inactive.
- Next ingest **skips** the feed.
- Past articles from that feed stay in the DB / queues / events.

**After soft-reactivate** — Back in the active set on the next ingest.

**Zero active feeds** — Allowed, with a **warn**. Ingest effectively no-ops until something is active again.

Workspace-created feeds remain `rss` only; `source_type` and `last_fetched_at` are not editable from Config. No “fetch now” in this effort.

## Inventory (monitored vendor products)

**Before add** — Hub “active products” = M. Filter/entity match only current **active** monitored vendor products (live SoT = Postgres after #36).

**After add**

- DB + Config UI update immediately.
- **Next filter/entity** run can match the new product / aliases / news volume.
- Articles already `IGNORED` or past the filter: **unchanged**.
- Articles still `NEW`: next filter can KEEP them if they match.

**After edit** (aliases, criticality, news volume, names, active, etc.)

- Config immediate; pipeline on the **next** filter/entity run.
- Quiet ↔ noisy changes Layer-2 cheap-filter strictness only for articles filtered **after** the edit.
- Existing canonical events / classifications are **not** rewritten.

**After soft-deactivate (“remove”)**

- Hub active count −1; row still visible as inactive.
- **Forward only:** next filter will not treat it as monitored.
- Does **not** detach old events, clear entities, or revive/drop history.
- Rejected if it would leave **zero** active monitored vendor products.

**After soft-reactivate** — Matching returns on the next filter/entity for `NEW` (and re-queued) articles.

## Config hub cards

| Action | Hub “Feeds — N active” | Hub “Inventory — M active” |
|--------|-------------------------|----------------------------|
| Add active feed / product | N or M ↑ right away | same |
| Soft-deactivate | ↓ right away | ↓ right away |
| Edit fields only (still active) | unchanged | unchanged |
| Soft-reactivate | ↑ | ↑ |

Hub reflects **DB truth**, not pipeline lag. On-page copy states that pipeline behaviour catches up on the next run and that `IGNORED` history is not bulk re-scanned.

## Escape hatch: filter re-queue after inventory edit (locked)

**Primary case:** cheap filter DROPped an article to `IGNORED` because of a missing or wrong alias (or similar inventory gap). The analyst fixes inventory, then gives **selected** articles a second chance.

**Locked flow:**

1. Edit inventory (e.g. add aliases) → Save → DB updates immediately.
2. Open each Workspace article still `IGNORED` that should be reconsidered.
3. **Filter re-queue** → status `NEW` (clear ignore reason).
4. **Next filter** sweep re-runs cheap filter against current inventory; if KEEP, extraction and later stages run as a normal forward pass.

**Locked constraints:**

- Selective only — analyst picks which `IGNORED` articles to revive.
- Inventory Save does **not** auto-requeue matching or all `IGNORED` rows (avoids flooding the queue with old noise).
- No bulk historical rescan. Manual-articles imports remain eval-only / out of scope.

This is the inventory catch-up path; Feeds have no equivalent article re-queue in this effort (forward ingest only).

## Ticket phase note

| Ticket | Role in this flow |
|--------|-------------------|
| #35 | Hub + read-only lists (see DB; no UI mutations yet) |
| #36 | Pipeline loads monitored inventory from Postgres |
| #37 | Inventory add / edit / soft-deactivate in Config |
| #38 | Feed add / edit / soft-deactivate in Config |
| #39 | Filter re-queue on Workspace article |

Seed upsert/reset behaviour stays unchanged for local testing; re-seeding a living DB can overwrite Workspace edits.
