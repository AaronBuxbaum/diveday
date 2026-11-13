# inbox-assists

This module owns the inbox assists use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.

`draftReplyToMessage` answers the selected authenticated, nonspam message in the session’s shop, including unmatched senders. It reuses the shop's public facts (hours, address, departures, courses, rental gear, what to bring, notes) and the existing assist budget. A health question still gets a kind reply with no medical opinion. Drafting creates no booking or outbound message; staff review the text before copying or opening email.
