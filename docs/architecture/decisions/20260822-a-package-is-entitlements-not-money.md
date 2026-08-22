# 20260822-a-package-is-entitlements-not-money — A prepaid dive package counts dives, never a balance

- **Status:** Accepted
- **Date:** 2026-08-22
- **Issue:** [706](https://github.com/AaronBuxbaum/diveday/issues/706)

## Context

After a two-tank morning, a prepaid dive package is the product a warm-water shop sells most. "Ten
dives, valid this season." It is how a shop turns a two-day tourist into a six-day one, it is the
whole economics of a resort operation, and DiveDay cannot sell one: grep for `punch card` and there
is nothing, and `package` outside `package.json` is two unrelated comments.

A shop that runs packages today either takes the money outside the app — which breaks the single
money story, the owner report, the export and the entire switching pitch — or writes a shop-wide
promo code with a redemption cap and hopes.

The roadmap holds two adjacent entries and this is neither of them:

- **Gift cards** are stored *value*, redeemable against anything, carrying jurisdictional
  unclaimed-balance rules. Deferred for good reasons of its own.
- The brainstorm's **credit ledger** is framed throughout as *compensation* — a blow-out
  alternative, a buddy referral credit.

A package is a **sales product**: a fixed unit, a count, usually an expiry, usually a restriction to
a class of departure.

## Decision

**A package is a count of entitlements, not a balance.** One `dive_package_entitlements` row is one
dive a diver has already paid for and not yet taken.

Modelling it as stored value gets the arithmetic wrong the moment two departures have different
prices, which is the normal case: a diver who buys "ten dives" for $900 and takes a $180 wreck
charter has used **one dive**, not $90 of $900. Every shop that sells packages sells them precisely
so the diver stops thinking about the per-dive price, and a stored-value model quietly reintroduces
it — most sharply on the expensive departure, where the diver discovers their ten dives were seven.

Three consequences follow, and each is the reason a later reader will find this file:

**Consumption settles through the payment gate that already exists.** A booking covered by an
entitlement reaches `setBookingPayment` like every other paid booking. There is deliberately no
second path to "paid": `PAYMENT_CLEARED` is what readiness, the manifest and the counter all consult,
and a package that wrote its own status would be a fourth spelling of a fact three surfaces already
agree on.

**An entitlement is consumed, never spent.** It carries the booking it was used for, so returning it
on a cancellation is undoing a link rather than crediting an amount — which means a cancelled
booking cannot round, cannot drift, and cannot return more than it took.

**Scope is a property of the package, not of the checkout.** "Fun dives only" is what the shop sold;
resolving it at booking time against the departure is a read, and the answer never depends on when
the diver books.

## Amendment, 2026-08-22: what "one dive" means is not settled either

A `dive-domain-expert` and a `security-reviewer` pass over the first implementation found that this
decision, as written, answered several product questions **silently** — and that the first of them
is the one that may send the schema back.

**The unit is the open question, and it is not an engineering call.** Every warm-water shop sells
"ten dives" meaning ten *tanks*. Ten dives is five two-tank mornings. The first implementation spent
one entitlement per **booking**, which makes a ten-pack buy ten two-tank charters — twenty tanks for
the price of ten. `trips.plannedDives` already exists and the booking request already reads it, so
the data is there; what is missing is the answer. It has a hard sub-question: a diver holding one
dive who books a two-tank charter either has the coverage refused, or gets one tank covered and pays
for the other, and those are different products.

Six more were answered by omission rather than by decision, and each will be contested by a real
shop:

- **Does a package cover instruction?** The `scope` column defaults to `all`, so out of the box a
  ten-pack covers an $800 course session. `fun_dives` is the safer default; `all` is the deliberate,
  unusual choice.
- **When exactly does a package lapse?** `validityDays` is fixed-millisecond arithmetic from the
  purchase instant, so a package bought at 14:32 refuses the 15:00 dive on its last day, and it
  drifts an hour across a DST boundary. It also cannot express *"valid this season"* — this
  document's own headline example — which is a fixed end date, not a rolling window.
- **Does a shop-cancelled departure give the dive back?** Answered *no*, by omission: a blow-out
  never cancels its bookings, so the entitlement stays spent on a boat that never sailed — and the
  seat lands in the owed-cash-refund queue, so the shop pays for a dive it was prepaid for.
- **Does a no-show forfeit the dive?** Answered *yes*, by omission.
- **Are packages transferable?** Answered *yes*, by omission: a seat claim re-points the booking's
  person and leaves the entitlement on the buyer.
- **Does a diver hold dives before paying the invoice?** Answered *yes*, by omission and against
  this document's own claim: `createOrder` raises an invoice that is `open` until Stripe reports
  payment, so entitlements exist before any money moves, and nothing revokes them when an order is
  voided, refunded or written off.

**Nothing above changes the core decision** — entitlements rather than a balance, consumption
through `setBookingPayment`, a link undone rather than an amount credited. Both reviewers said so
explicitly. What it changes is that the feature does not reach `bookSpot` until the unit is settled,
because every surface above it has to agree about what it is counting.

The tables shipped ahead of that answer and are unused: no production path grants an entitlement, so
changing the unit costs a migration and nothing else (H-49, pre-pilot).

## What this decision does not settle

Two questions in the originating issue are **not** engineering calls and are deliberately left open
rather than defaulted quietly:

- **Revenue recognition.** Whether a package's money is recognised at purchase or as it is consumed
  is an owner and accountant call, and it differs by jurisdiction. Until it is answered, the order
  is recorded at purchase exactly like any other order, and the entitlement rows carry their own
  `consumed_at` — so whichever answer arrives, the evidence to report it either way is already on
  disk. Nothing in this decision has to change to support the other choice.
- **Expiry.** What a lapsed package does to unused prepaid dives is policy, and an expiry that
  silently eats them is the thing that generates the complaint. The column exists and is nullable;
  a package with no expiry never lapses, which is the behaviour that cannot surprise anyone.

## Alternatives considered

**Stored value — a balance in minor units.** The shape gift cards will need, and the reason it is
wrong here is arithmetic rather than taste: a diver who buys ten dives for $900 and takes a $180
charter has used one dive, and a balance says they have used two. It also drags in the
unclaimed-balance rules that are exactly why gift cards are not scheduled, for a product that does
not need them.

**A promo code with a redemption cap.** Nearly possible today, and the wrong shape for the same
reason a discount is not a purchase: `shop_promo_codes` computes a reduction at payment time and
holds none of the diver's money. It also cannot answer "how many dives do I have left", which is the
question a diver asks on day three.

**Decrementing a counter on the person, rather than rows.** Cheaper, and it loses the two facts that
make refunds and reporting tractable: which booking consumed which dive, and when. A counter cannot
be handed back precisely on a cancellation, and it cannot support consumption-based revenue
recognition at all — so it would decide the open question above by accident, in the direction that
is harder to reverse.

**A new payment status for "covered by a package".** Rejected outright. `PAYMENT_CLEARED` is what
readiness, the manifest and the check-in counter all consult, and a fourth spelling of "this seat is
paid for" is how three surfaces come to disagree about one fact.

## Consequences

- A shop with no packages sees no change anywhere. The tables are empty, every read short-circuits,
  and no surface renders — the same opt-in-by-presence shape the gear register uses
  (ADR 20260815-minimal-gear-register).
- `bookSpot`'s capacity transaction gains a consumption step. It is safety-critical and already
  serialised; the entitlement claim happens inside the same transaction, so two concurrent bookings
  cannot spend one dive twice.
- Unlimited and subscription packages are explicitly out of scope. "Unlimited shore diving for a
  week" is a real product and a harder one; an entitlement with a count is the tractable ninety
  percent.
