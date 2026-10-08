# 20261008-gear-work-orders — Build repair work orders on the bench beside the register, and drop "no repair" from the non-goals

- **Status:** Accepted (2026-10-08)
- **Date:** 2026-10-08

Reverses one half of a vision non-goal by product-owner instruction, the way
[20260815-minimal-gear-register](20260815-minimal-gear-register.md) reversed item-level inventory.
Retail — selling things, counting parts stock, a barcode at a till — stays declined.

## Context

[20260815-minimal-gear-register](20260815-minimal-gear-register.md) shipped the shop's own fleet as
tagged units with per-unit service clocks, and said at the time that a care event is "deliberately
not a work order — no parts, no labor, no billing." The shops we are selling to run a service bench
as a matter of course: a customer's regulator comes over the counter in March, it is tagged, it
sits on a shelf, a technician works it, and somebody has to be able to answer "where is my
regulator" and "what did you do to it" a year later. Today that answer lives on a paper card, and
the shop's own cylinders — the ones DiveDay already tracks — are worked on the same bench by the
same technician with no record at all beyond a service event somebody remembers to write.

Constraints a lower-context agent must not miss:

- **A customer's gear is not the shop's fleet.** `gear_items` is the shop's own rental units; a
  diver's own regulator is a different thing and gets its own table. One ticket covers one or the
  other, never both (the `work_orders_one_subject` check).
- **Opt-in by presence**, like the register: the Gear nav appears when a shop has a fleet unit *or*
  a work order, never a settings flag.
- **A ticket is not money.** Parts and labor are the shop's working figures; invoicing stays with
  orders and Stripe, and the printed claim tag carries no total.
- **Rental code is somebody else's.** Reservations, the due-back view and double-booking are not
  edited by this record. A shop unit's register *status* is touched, through the register's own
  writers: opening a ticket on a unit takes it off the wall (`needs_service`, the reported problem
  as its note), so the packer stops handing out a regulator that is on the bench.
- **Nothing a ticket does writes a clock except the Work done record.** A status move, pickup
  included, never touches `gear_service_events` or a customer's due date.

## Decision

Six tables (`customer_gear_items`, `work_orders`, `work_order_items`, `work_order_lines`,
`work_order_care`, `work_order_events`), every one carrying `shop_id`, outside the retention prune,
and in both the shop and the diver export. Each ticket has a short number, the shop's next from 1
and never reused (`work_orders_shop_number_unique`, allocated under a lock on the shop's row), which
is what the claim tag, the board and a phone call use. A ticket moves through five statuses — received, in
progress, waiting on parts, ready for pickup, picked up — any open status to any other, with
`picked_up` terminal: a ticket that comes back is a new ticket. A shop unit's ticket skips `ready`
(nobody collects the shop's own regulator) and its closed state reads "Back in service" only when
the work was recorded as done. Status moves, technician handovers
and the opening append to `work_order_events`, ordered by a `bigserial` sequence so two acts in one
second read in the order they happened.

The bench is the Gear section's second tab (`/shop/[shopSlug]/gear/work-orders`): a board grouped
by status with the open statuses first, a ticket page carrying status, technician, notes, work
performed, parts and labor with a running total, and a printable claim tag that follows the rental
slip's posture — no signature, no money. A diver's record grows one file group holding their own
pieces and their tickets.

**The Work done record** is the only path from a ticket to a clock. The technician says how the job
ended (done, declined, unserviceable, condemned; the last two with a reason) and, for a done job,
each check performed: which care (service, visual inspection, hydro test, O2 clean, or other work
with no clock), passed or failed, the day it was performed, and the next due date they confirm. The
form prefills that date: a shop unit carries its own previous interval forward, dive count
included; a customer's regulator or BCD gets the conventional service interval; a cylinder, a
computer, a torch and everything else get none. Then:

- **A shop unit**: each passed check is written through the register's `recordGearService`, and the
  unit returns to service only when every check passed and one of them answers a concern on that
  kind of unit. A failed check writes nothing, so a failed hydro never reads as a fresh one.
  Declined leaves the unit as it was; unserviceable or condemned keeps it off the wall with the
  reason as its note. Deleting an open ticket puts the unit back as it was before, and restoring
  takes it off again.
- **A customer's piece**: a cylinder has two dates (visual inspection and hydro test) and every other
  kind one service date. A passed check sets the matching date, counted from the day the work was
  performed and never from pickup, and replaces a date staff typed; with no passed check the staff
  date stands.

Technicians are staff and the surfaces are ungated like the rest of gear (H-06, as amended
2026-08-20): handing equipment over the counter and working it are day jobs.

## Alternatives considered

- **A work order as a `gear_service_events` row with extra columns** — a care event is a fact about
  one unit; a ticket is an open piece of work about a *person's* gear, with a status, an owner and a
  promise date. Widening the event table would have put nullable ticket columns on every tank's VIP.
- **One table for a customer's gear and the shop's fleet** — every read in the register would have
  had to exclude customer rows, and the first missed filter puts a diver's regulator on a boat.
- **Billing on the ticket** — orders already own money, and two places to raise a charge is how a
  shop double-bills. Lines stay figures until somebody raises an order.
- **A sixth status for "quoted"** — no shop has asked, and a status nobody moves out of is a column
  that silts up. Revisit when a pilot shop asks for approval before work starts.

## Consequences

The bench is now where a shop's service work lives, and the register's service clocks can be
written by the recorded work that moved them, with the values a technician confirmed. A shop that only rents sees one extra tab and
nothing else; a shop that only repairs can use DiveDay with no fleet at all, because a ticket on a
customer's gear needs no `gear_items` row.

It commits us to the bench as a first-class surface: notifications when a ticket is ready, a
service-due reminder on a customer's piece, and the Today queue's "ready to collect" row are the
obvious next slices and are deliberately not in this one. It also commits us to keeping parts
*stock* out: the moment a line decrements an on-hand count we are a retail system, which the vision
still declines.

Revisit if a pilot shop needs a customer to approve an estimate before work starts, or needs the
ticket to raise its own invoice — the first is a status and a token page, the second is an order
built from the ticket's lines, and neither changes these tables.
