# 20260820-waiver-delivery-is-per-channel — What we know about a waiver link is recorded per channel

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

`waiver_records` carries a single delivery block — `delivery_status`,
`delivery_provider_message_id`, `delivery_provider_status`, `delivery_provider_status_at`,
`delivery_error` — written by the one seam every issue-and-deliver path ends at,
`recordWaiverDelivery` (`src/db/waivers.ts`). One record, one outcome.

That was true when a waiver went out one way. It stopped being true with the diver record's four
peer CTAs (#573): **Email waiver**, **Text waiver**, **Copy link**, and the paper attestation, each
of which a staffer picks for a fact about the person standing in front of them. And now each of
those buttons is supposed to wear what we last knew about *its own* channel — an outline plus a
mark, so a staffer can see that the email bounced and the text landed without opening anything.

A single latest-attempt column cannot light more than one of them. Worse, it actively lies: a shop
that emails a diver and then texts them has two facts, and the second write erases the first. The
button offering the channel that failed would come back blank.

## Decision

Add `waiver_deliveries` — one row per `(waiver_record_id, channel)`, holding that channel's
current state — and **keep** the record-level block beside it.

The two answer different questions, which is why both stay:

- `waiver_records.delivery_*` is **the latest attempt on this link, whichever way it went**. It is
  what `getDiverWaiverRequestStatus` reads for "has this diver been reached at all?", and what the
  delivery webhook's independent-waiver branch keys on.
- `waiver_deliveries` is **per channel**, and exists so a second channel cannot erase the first.

This is the same split `notification_deliveries` and `notification_delivery_attempts` already draw
in this schema: a denormalized current state beside a finer-grained record of how it got there.

`applyProviderEmailEvent` updates the per-channel row **first and unconditionally**, before the
branch that returns as soon as `notification_deliveries` matches — a booking-scoped waiver email
writes both, and folding the new update into that branch would mean a bounce never reached the
button that offered to send it.

The channel enum carries `link` alongside `email` and `text`. Taking a URL is not a delivery, but
recording it is what keeps a diver whose only "send" was a copied link from reading as never sent —
the behaviour the record-level column already had.

## Alternatives considered

- **Add `delivery_channel` to `waiver_records`.** One column, no table. Rejected: it names which
  channel the latest attempt used and still forgets the other one, which is the whole problem.
- **Drop the record-level columns and read everything from the new table.** One source of truth,
  and tempting. Rejected on blast radius rather than principle: it is a destructive migration that
  also moves the webhook's fallback path, `getDiverWaiverRequestStatus`, and the shape of
  `waiver_records.csv` in the export bundle — three careful, separately-tested things, for a
  redundancy the repo already accepts one table over.
- **Per-channel columns on `waiver_records`.** Two more delivery blocks inline. Rejected: it does
  not generalise past the channels that exist today, and WhatsApp is already a sender this product
  knows about.

## Consequences

- Every `recordWaiverDelivery` caller passes `shopId` and `channel`; both call sites in
  `src/db/waiver-issue.ts` already had them in scope, so the drift is a compile error.
- `waiver_deliveries` is shop-scoped, so it joins both hand-maintained delete orderings
  (`resetDemoSchedule`, `deleteDemoShopCascade`) ahead of `waiver_records`, and it is decided as
  **excluded** from the export bundle — the outcome another system could act on is already on
  `waiver_records.csv`; these rows are the mechanics behind it.
- The per-channel state is scoped to the *pending, unsuperseded* record. A channel's outcome
  describes one link, so a bounce from last month never rings a button for a link issued this
  morning.
- **Escape hatch.** If a third question ever needs the record-level block — or if it stops being
  read at all — collapse it into `waiver_deliveries` and drop the columns. The trigger is a second
  reader wanting "latest attempt regardless of channel"; today there is exactly one, and the cost
  of leaving it is five columns nothing else writes.
