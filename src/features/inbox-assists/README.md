# inbox-assists

This module owns the inbox assists use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.

`draftReplyToMessage` answers the selected authenticated, nonspam message in the session’s shop, including unmatched senders. It reuses the shop's public facts (hours, public shop address, departures, courses, rental gear, what to bring, notes) and the existing assist budget. The prompt asks for a kind reply without a medical opinion; staff must review the actual draft. Drafting creates no booking or outbound message; staff review the text before copying or opening email.

Departure facts cover a bounded 45-day window with at most 40 public departures. An empty list says no public departures are listed in that window, not that the shop has no trips at other times. Structured trip meeting labels and addresses are omitted: this shop-wide reader has no booked-recipient authorization. Booked trip-prep details and the public shop address are unchanged; this does not classify or scrub arbitrary descriptions and shop-authored reply notes.

Local fake-provider and UI tests establish context boundaries and the staff-review interaction. They do not measure live-model accuracy, medical-answer quality or prompt-injection resistance.
