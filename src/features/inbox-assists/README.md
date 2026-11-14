# inbox-assists

This module owns the inbox assists use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.

`draftReplyToMessage` answers the selected authenticated, nonspam message in the session’s shop, including unmatched senders. A bounded, read-only tool fetches the current shop's public facts (confirmed hours, public shop address, departures, courses, rental catalog and prices, what to bring) on request; model input cannot choose the shop. Shop-authored notes are separate untrusted input. A draft without a successful lookup is refused, and the existing assist budget covers both provider turns. The prompt asks for a kind reply without a medical opinion; staff must review the actual draft. Drafting creates no booking or outbound message; staff review the text before copying or opening email.

Departure facts cover a bounded 45-day window with at most 40 public departures. An empty list says no public departures are listed in that window, not that the shop has no trips at other times. Course lists and the overall response are bounded and disclose truncation. Rental catalog entries do not establish unit availability. Structured trip meeting labels and addresses are omitted: this shop-wide reader has no booked-recipient authorization. Booked trip-prep details and the public shop address are unchanged; this does not classify or scrub arbitrary descriptions and shop-authored reply notes.

Local fake-provider and UI tests establish context boundaries and the staff-review interaction. They do not measure live-model accuracy, medical-answer quality or prompt-injection resistance.
