# H-20261013-call-off-queues-refunds: Which roles may trigger a cancellation that refunds money?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Four doors call departures off, and each cascade refunds the card captures on them. Who may cause that money to move?** The doors were gated differently: "Cancel every upcoming date" and the narrowing cancel by `canConfigureTrips` (owner, manager, instructor), the single-trip blow-out by every staff role, the day weather call by `canCallDayBlowout` (owner, manager, captain). An instructor could refund a whole run while no one but an owner or manager could press Refund on an order (H-20260724-staff-role-reach).

## Minimum outcome to record

Which role calls a departure off, and which releases the money.

## Outcome

**Chosen and implemented (Aaron Buxbaum, 2026-10-13, on issue #2459): the split.**

- **Who may call a departure or a run off is unchanged**: the single-trip blow-out stays open to all staff, the day call to owner, manager and captain, the run-wide and narrowing cancels to owner, manager and instructor.
- **Who moves the money is `canRefund`** (owner, manager; H-20260724-staff-role-reach), read from the live roles. A caller who holds it sends each card capture back as the cascade runs (ADR 20260813-shop-cancellation-refunds-itself). Anyone else cancels, tells the divers, and leaves every capture where it is: each diver is told a refund is owed, and the seat shows under "still owed money" on Orders.
- **A refund holder releases the queue** from the departure's blow-out page, "Send the card refunds back". It refuses a departure that is not canceled and is safe to repeat. Counter payments were never automatic and stay staff's to return.
- A system caller with no person behind it, the minimum-head-count sweep, still refunds by itself.

`src/app/shop/[shopSlug]/schedule/blowout/blowout-refunds.authz.test.ts` pins each door and each role, and `src/db/blowouts.test.ts` pins the queue itself.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
