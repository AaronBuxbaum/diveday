# H-20261014-paid-mark-amount-and: Who may mark a seat paid, and with how much?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**When a staffer marks a seat paid on the roster, what must they record, and who may mark it paid with no money?** Before batch 6 the roster's "Paid" mark stored no amount, so cash taken at the dock showed as $0 on Reports.

## Minimum outcome to record

Who may record an amount, who may mark paid with none, and what the mark keeps.

## Outcome

**Built with the recommended answer (batch 6 item 1, 2026-10-14), awaiting confirmation:**

- **Any staff member** records an amount and a method (cash, card, other) when marking a seat paid or deposit paid. The mark keeps the amount, the method and who marked it, on `booking_payments` and its trail (`method`, `recorded_by_person_id`), and the roster says it back ("$120 cash, marked by Ana").
- **Only an owner or manager** (the refund right) may mark a seat paid with no money: a write-off. Anyone else without an amount is told to enter one.
- The amount reaches Reports as money held; the method is exported with the payment trail.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
