# FU-20260820-self-service-booking-mutations — Decide whether `selfCancelBooking` and `rescheduleBooking` still have a job

- **Status:** Open
- **Raised:** 2026-08-20 — the `/ready` rework that deleted the "Need to change your plans?" section (ADR 20260820-shop-handles-plan-changes)
- **Kind:** question
- **Effort:** M
- **Touches:** `src/db/bookings.ts`, `src/db/bookings.test.ts`, `src/db/money-replay.test.ts`, `src/db/courses.test.ts`, `src/db/booking-capabilities.ts`, `src/db/booking-capabilities.test.ts`

## What I noticed

`selfCancelBooking` and `rescheduleBooking` (`src/db/bookings.ts`) now have **no caller in the
app**. Their only two were `cancelMyBookingAction` and `rescheduleMyBookingAction` on the diver's
readiness page, and both were deleted when the "Need to change your plans?" section came out.

What is left pointing at them is tests: about 350 lines in `src/db/bookings.test.ts` written
against them directly, one `rescheduleBooking` call in `src/db/courses.test.ts` (checking a course
prerequisite is re-enforced on the destination trip), and `src/db/money-replay.test.ts`, which uses
`selfCancelBooking` as its way of reaching `refundBookingOnCancellation` twice over to prove the
refund is not replayed.

`resolveRevokedBookingCapability` (`src/db/booking-capabilities.ts`) is in the same position — its
one caller was the `?cancelled=1` branch of `/ready`, which is gone. It still has its own describe
block in `src/db/booking-capabilities.test.ts`.

## Why it isn't already done

"There is no legacy. Delete it." (AGENTS.md) says these should go, and I did delete the smaller
sibling on this path — `recordDiverNitroxCard` — for exactly that reason. I stopped short here for
two reasons that are about judgement rather than effort.

First, **the deletion is not the interesting part; the product call is.** Aaron asked for the
section to come off the page. Whether a *diver* may ever cancel their own seat again, or whether a
staff surface should get an atomic "move this booking to that trip" built on the same function, is
his call and not an agent's — and the functions are the reusable half, not the deleted half.

Second, **`money-replay.test.ts` would lose real coverage, not just a caller.** It drives
cancel-then-refund twice to prove `refundBookingOnCancellation` is idempotent under replay. Ported
to the staff `cancelBooking` path that property still holds, but the port is a rewrite of the test's
setup rather than a rename, and doing it as a drive-by inside a UI change is how a money test
quietly gets weaker.

## Proposed change

Answer the product question first, then one of two mechanical follow-ons:

- **If the capability is gone for good:** delete `selfCancelBooking`, `rescheduleBooking` and
  `resolveRevokedBookingCapability`, their describe blocks, and the `MAX_RESCHEDULE_CANDIDATES`-era
  vocabulary that survives in comments. Port `money-replay.test.ts` to `cancelBooking` and
  `courses.test.ts` to `createBooking` against the destination trip, keeping the assertions
  identical. Confirm `booking_capabilities` still needs no revoked-lookup path.
- **If a staff-facing "move this booking" is wanted:** keep `rescheduleBooking`, give it a surface
  on the trip roster (`src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx`), and
  delete only `selfCancelBooking` and `resolveRevokedBookingCapability` — staff already cancel
  through `cancelBooking`.

Not proposed: putting the diver-facing section back as-is. That is what the ADR decided against,
and reopening it should be a new decision rather than a revert.

## Prompt

```text
In the DiveDay repo, decide the fate of two now-uncalled domain functions and act on the answer.

Read first: docs/architecture/decisions/20260820-shop-handles-plan-changes.md (why they lost their
callers), src/db/bookings.ts (`selfCancelBooking` ~line 1010, `rescheduleBooking` ~line 1113), and
src/db/money-replay.test.ts.

The constraint that makes this non-obvious: `selfCancelBooking` and `rescheduleBooking` have no
caller in src/app any more, and AGENTS.md's "There is no legacy. Delete it." says they should go —
but money-replay.test.ts uses `selfCancelBooking` as its route into the refund-replay path, so
deleting it without porting that test to the staff `cancelBooking` path silently weakens a money
test. `resolveRevokedBookingCapability` in src/db/booking-capabilities.ts is in the same position.

Ask Aaron which branch applies before writing code — (a) the diver-facing cancel/move is gone for
good, so delete all three functions and port their tests, or (b) a staff-facing "move this booking
to another trip" is wanted on the trip roster, so `rescheduleBooking` earns its keep and only the
other two go.

Done when: no unreachable function is left behind whichever way it goes, every assertion that
money-replay.test.ts and courses.test.ts make today still runs against some caller, and
`pnpm check` is green. Delete docs/product/follow-ups/FU-20260820-self-service-booking-mutations.md
as part of the change.
```
