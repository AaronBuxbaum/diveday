# H-20261015-party-payment-split: How does one cash payment divide across a party?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**A party lead pays cash at the dock for four people. How does "Mark the party paid" divide one amount across the seats, and does it need the write-off right (H-20261014-paid-mark-amount-and)?** The Paid mark records one seat at a time, so a party meant four marks and a split done by hand. Issue #2605 left the split rule, the short-payment rule and the overpayment rule open.

## Minimum outcome to record

The order the money lands in, what happens when it runs out, and what happens when it is too much.

## Outcome

**Chosen and implemented (the issue's recommendation, 2026-10-15, built on issue #2605): balance first, never a write-off.**

- **Each seat takes its balance owed, in turn, and never more.** The lead's seat first, then the party by name. A seat with a deposit already on it owes the rest, and a share adds to a deposit taken by hand rather than replacing it.
- **When the money runs out, the seat it runs out on takes the rest as a deposit** (Deposit paid) and the seats after it are left alone and still owe. Nothing is written off by the split, so it needs only the right to record money, the same as a single Paid mark; the owner-or-manager rule (H-20261014-paid-mark-amount-and) has nothing to gate. Writing off a balance stays the single seat's Paid mark.
- **More than the party owes is refused**, not spread: the extra has no seat to land on.
- **A seat paid online or from a package that still owes refuses the whole party**, as it refuses the single mark, so a staffer is never unsure what was taken. A paid-online seat that owes nothing is skipped.
- **The split is previewed, then confirmed.** The first step shows the server's own division, seat by seat; the confirm works it out again from the database, in one transaction, and each seat gets its own activity line (`party_marked_paid`).

`src/lib/payment-marks.test.ts` pins the split, `src/db/payment-marks.party.test.ts` the transaction and tenant scoping, and `actions.authz.test.ts` the roles.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
