---
status: accepted
---

# Publication status gates the public catalogue

Phase-1 public launch must not wait on eval maturity, but raw pipeline output is not safe to show as curated incidents. We decided that a canonical event has an independent **publication status** (`draft` | `approved`), separate from incident lifecycle `event_status` (e.g. open/closed). **Event approval** sets `approved`; **event unpublish** returns it to `draft`. The public portal lists only approved events, and only articles attached to at least one approved event. Pipeline-created events start as `draft`. After approval, the pipeline may continue enriching the event in place (new sources, field updates) without auto-unpublishing — matching “do not suppress same-event material updates.” Alerts are not gated by publication status in this phase.

**In scope:** publication status field and semantics; public catalogue visibility rules; analyst create/edit (fields + article membership) then approve/unpublish; sticky approval under pipeline updates.

**Out of scope:** gating outbound alerts on approval; merge/split of existing events; dual public snapshots / re-approval on material change; hosting eval tooling on the public app.

## Considered options

- **Overload `event_status` with draft/published** — rejected; conflates incident lifecycle with portal visibility.
- **`approved_at` null-only** — rejected as the sole signal; explicit status is clearer for query and revoke-to-draft.
- **Approval also gates alerts** — deferred; couples launch to notification hardening.
- **Re-approve or freeze a public snapshot on pipeline updates** — deferred; heavier model, fights material-update continuity.
- **Show all articles publicly, hide unapproved event links** — rejected; chosen rule is articles appear only when tied to an approved event.

## Clarification (2026-07-14)

Public list/detail filters use publication status alone. **Event approval** additionally hard-requires at least one affected vendor or product on the event (enforced in the editorial seam) so analysts must identify impact before publish. That is not a second public hide filter — Approve and public visibility stay aligned.
