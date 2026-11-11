# inbox-assists

This module owns the inbox assists use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.

`draftReplyToMessage` answers the selected authenticated, nonspam message in the session’s shop, including unmatched senders. It reuses public reply facts, grounding, health/eligibility refusals and the existing assist budget. Drafting creates no booking or outbound message; staff review the text before copying or opening email.
