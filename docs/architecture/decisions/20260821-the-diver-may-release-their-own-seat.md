# 20260821-the-diver-may-release-their-own-seat — Cancelling comes back to `/ready`; moving does not

- **Status:** Accepted
- **Date:** 2026-08-21
- **Supersedes:** [20260820-shop-handles-plan-changes](20260820-shop-handles-plan-changes.md)

## Context

[20260820-shop-handles-plan-changes](20260820-shop-handles-plan-changes.md) took the whole "Need to
change your plans?" section off `/ready` — a trip picker, a cancel button, a refund preview, and the
prose around them — and with it both diver-facing mutations. It was the right shape of decision on
the wrong scope: the section was a third of the page's markup and read as two irreversible controls
several screens below the one card that answers what the page is for, and the reschedule picker in
particular was reachable only on an unpaid, un-checked-in seat with another departure open. That ADR
said so in as many words and named the way back: *"it is reversible, the domain functions are still
there, and the argument for putting it back is a product argument rather than a technical one."*

The product owner made that argument on 2026-08-21: **bring the cancel back, leave the move out.**

The two are not the same capability wearing different verbs. Cancelling is reachable on essentially
every seat a diver holds — `selfCancelBooking` refuses only a seat that is not plain `booked`, or a
departure that has already sailed, so a *paid* diver can cancel and be refunded inside the shop's
stated window exactly as the staff path would do it. Moving was never reachable on a paid booking at
all, because the money has to move with the seat and that is a staff-mediated decision this product
does not automate. A picker that vanishes the moment a payment settles is a worse answer than a phone
number.

## Decision

**A diver may release their own seat from `/ready`. Moving one is the shop's.**

- `cancelMyBookingAction` returns to `src/app/ready/[token]/actions.ts`, rate-limited by
  `RATE_LIMITS.bookingSelfCancel` as before. Cancellation and refund stay the two independent steps
  the staff path uses (H-07): the seat is freed first, and a refund failure afterward neither
  re-opens it nor turns an already-committed cancellation into an error the diver cannot read.
- `getReadyPageData` recomputes `cancelPreview` and a new `canCancelBooking`. The control renders
  only when `selfCancelBooking` would honour it, so the page cannot offer a button that could only
  come back refused. `canCancelBooking` carries the same **one-hour late-departure buffer**
  (AGENTS.md) the domain function applies — the old page gate used a bare `startsAt > now` and was
  quietly stricter than the rule it was mirroring.
- The `?cancelled=1` branch returns with it, and so does its reason for existing: the cancel revokes
  its own token, so the verified-capability path can never show that diver their own confirmation.
  `resolveRevokedBookingCapability` resolves the dead token with the revocation check relaxed and
  nothing else. The query parameter is a trigger to look, never a claim — the refund copy is read
  from the booking's own payment row.
- **`rescheduleBooking` is deleted**, along with `RescheduleResult` and its 380-line describe block.
  It had no caller, it is not getting one, and AGENTS.md's "There is no legacy. Delete it." is not
  optional for a function kept warm against a decision that has now gone the other way.

## What the page looks like now

Not the old section. `/ready` became one spine on 2026-08-20 — a checklist and the things a diver
still has to do — and a heading with three paragraphs under it would put the page back where it was.
What lands is the smallest thing that is still honest: the money consequence, then the control, last
on the page, directly above the shop card whose phone number answers every plan change this button
does not. `ready.cancelLead` ("Cancelling frees your seat right away") is **not** restored — it
explains what the button already says. The refund preview is, in both places it mattered: once beside
the control, and once inside the confirm, because a diver past the free-cancellation window finding
that out after the tap is the failure the preview exists to prevent.

## Consequences

- Three tests written against `rescheduleBooking` are ported rather than dropped, each keeping its
  assertion: `money-replay.test.ts`'s late-settling checkout now releases the seat and books the
  other one — the same two rows in the same order — and still proves neither ends up paid;
  `courses.test.ts` and `bookings.test.ts` reach the destination trip's own age and prerequisite
  gates through `createBooking`, which is now the only way in. What genuinely does not survive is
  the *atomicity* half of those cases, because the operation it was a property of no longer exists.
- `selfCancelBooking` and `resolveRevokedBookingCapability` have callers again, which closes
  `FU-20260820-self-service-booking-mutations` in a direction neither of its branches anticipated:
  not "delete all three", not "keep the move for staff", but cancel-returns-and-move-goes.
- A diver on a paid seat past the free-cancellation window can still cancel, and is told before they
  commit that the money does not come back. That is the shop's stated policy being enforced by the
  shop's own field, not a new one.

## Alternatives considered

**Put the whole section back as it was.** Rejected: the reschedule picker's reachability problem is
unchanged, and the layout complaint the previous ADR answered is a real one that has since been
built around.

**Keep `rescheduleBooking` for a staff "move this booking" surface** (branch (b) of the follow-up).
Rejected as speculative — nobody has asked for it, and the function can be written again from the
same primitives the day somebody does. Keeping 240 lines of domain code and 380 lines of tests warm
against that day is exactly what the repo's no-legacy rule is aimed at.
