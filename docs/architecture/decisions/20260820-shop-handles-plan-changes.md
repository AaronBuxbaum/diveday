# 20260820-shop-handles-plan-changes — The diver's cancel and move come out of `/ready`

- **Status:** Superseded by 20260821-the-diver-may-release-their-own-seat
- **Date:** 2026-08-20
- **Supersedes:** [20260727-diver-self-service-cancel](20260727-diver-self-service-cancel.md)

## Context

`/ready` closed with a "Need to change your plans?" section: a trip picker that moved the booking,
a cancel button with a refund preview, the shop's phone number on the paths where neither applied,
and `TripTerms cancellationOnly` restating the free-cancellation window. It was the last block on
the page and about a third of its markup.

The page around it changed shape first. [20260820-one-page-after-booking](20260820-one-page-after-booking.md)
folded the booking confirmation into this route, so `/ready` is now the page a diver lands on the
moment they book, the page every reminder links to, and the page they open on the morning of the
dive. The question that page answers is **"am I ready, and what's left?"** — and the answer, said in
one card at the top, was followed several screens later by two irreversible controls in the diver's
own hands.

The controls were also the narrowest ones on the page. `manageState` had three values and only
`self_serve` rendered anything the diver could act on; that state required an unsettled payment, a
`booked` seat, and a departure still ahead. A paid booking — the case where "I need to change my
plans" costs somebody real money — could only ever read a paragraph and a phone number, which is
the same answer the shop card at the foot of the page already gives.

## Decision

**The section goes, and so does the diver-facing capability behind it.** A diver who needs to move
or cancel calls the shop, whose number, address and map are on this page already.

Deleted with it:

- `cancelMyBookingAction` and `rescheduleMyBookingAction` (`src/app/ready/[token]/actions.ts`), and
  the `error-cancel` / `saved-rescheduled` / `error-reschedule` notices only they produced.
- `cancelPreview`, `rescheduleCandidates`, `rescheduleBlocked`, `manageState` and
  `canManageBooking` from `getReadyPageData`, along with the upcoming-trips scan that filled the
  picker — an extra query on every load of the busiest diver page in the app.
- The page's `?cancelled=1` branch. It existed for exactly one redirect: the diver's own cancel
  revoked its own token and then sent the diver back to it, so the page resolved the *revoked*
  capability to show an honest refund notice rather than "this link isn't available". Nothing else
  ever produced that parameter.
- 23 diver message keys in both locales, and `e2e/self-service-reschedule.spec.ts`.

**`selfCancelBooking` and `rescheduleBooking` stay in `src/db/bookings.ts` for now**, with their
tests. They are correct, they are the atomic implementations of two operations a staff surface may
well want, and `money-replay.test.ts` drives the refund-replay path through them. Removing them is
a second decision about the *domain* layer rather than about this page, and it was filed as `FU-20260820-self-service-booking-mutations` rather than taken here by an agent, and
answered on 2026-08-21 by the ADR that supersedes this one: cancel came back, the move did not, and
`rescheduleBooking` was deleted.

## Consequences

- A diver on an unpaid booking who wants a different Saturday now phones or emails instead of
  self-serving. That is a real capability loss, and it is the point of this being an ADR: it is
  reversible, the domain functions are still there, and the argument for putting it back is a
  product argument rather than a technical one.
- The cancellation window is no longer restated on `/ready`. It is still on the public trip page,
  beside the booking button, which is where a diver reads terms before committing.
- `cancelledNotice` survives with one caller: a booking the *shop* cancelled, read on a link that
  won the race against the revoke. What it says about money still comes from the payment row and
  never from the URL, unchanged.

## Alternatives considered

**Keep the controls, drop the heading and the prose.** The literal reading of "remove the section":
leave the picker and the cancel button under the existing rule as unlabelled controls. Rejected —
an irreversible action with no heading over it is worse than one with, and it would have left the
`manageState`/`rescheduleBlocked` machinery in place to serve two anonymous widgets.

**Collapse it into a `<details>` at the foot of the page.** Keeps the capability at near-zero
visual weight, which is what [20260727-diver-self-service-cancel](20260727-diver-self-service-cancel.md)
was reaching for with "collapse the rare path". Rejected because it answers the layout complaint
and not the one underneath it: the section's *reachable* state needed an unpaid, un-checked-in seat
on a future departure, and on every other state it was a phone number the shop card already gives.
A disclosure hiding a control most divers cannot use is still a control most divers cannot use.

**Move it behind its own route (`/ready/[token]/change`).** Would keep the page clean and the
capability whole. Rejected as the most expensive option for the least certain benefit: a second
bearer-token route to write, cover, and reason about
(docs/engineering/capability-telemetry-runbook.md), built before anyone has asked for the feature
it preserves. If the capability comes back, it can come back as a route then.
