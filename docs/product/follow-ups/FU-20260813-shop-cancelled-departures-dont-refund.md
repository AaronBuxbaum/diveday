# FU-20260813-shop-cancelled-departures-dont-refund — Decide whether a cancellation the shop causes returns the diver's money by itself

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/follow-up-decisions-xgj9o3`, a sweep of the codebase for
  policy questions the product currently answers by accident rather than by decision.
- **Kind:** question
- **Effort:** M
- **Touches:** `src/db/blowouts.ts`, `src/db/trips-minimum.ts`, `src/db/refunds.ts`,
  `src/app/api/cron/minimum-seats/route.ts`, `docs/product/human-decisions.md`

## What I noticed

DiveDay automates the refund for the cancellation the **diver** causes, and automates nothing for the
two it causes itself.

A diver who cancels inside the shop's stated window gets their money back without a human touching
it: `refundBookingOnCancellation` (`src/db/refunds.ts`) reverses the Stripe charge through the shop's
own connected account (ADR 20260721-automated-cancellation-refund).

Both shop-side paths stop short of that.

**The weather blow-out.** `callBlowout` (`src/db/blowouts.ts`) cancels the departure, snapshots every
active booking, and mails each diver — and its own docblock states the position plainly: *"No money
moves here."* The reasoning given is sound as far as it goes — `refundBookingOnCancellation`'s
window/forfeit arithmetic is built for a diver-at-fault cancel and would forfeit a paid seat the shop
just cancelled — but the conclusion drawn from it was to fall back to the per-booking staff path
rather than to refund unconditionally. So the diver reads a message telling them their money is safe,
and the money does not move until a staff member with the H-14 refund role opens each booking and
issues it by hand.

**The below-minimum sweep, which is worse, because nobody is in the room.** The minimum-head-count
feature (ADR 20260813-minimum-head-count-departures) publishes a promise on the booking page — "runs
with at least 4 divers; if it hasn't got there by Thu 14 Aug, 7:30 AM, the shop cancels it and emails
everyone booked" — and keeps it with an hourly cron, `cancelDeparturesBelowMinimum`
(`src/db/trips-minimum.ts`, `src/app/api/cron/minimum-seats/route.ts`). That module touches payments
nowhere at all. A diver who paid a full fare at 11 PM for a Saturday charter can have it cancelled by
a machine at 4 AM, receive an email saying so, and be holding a captured Stripe charge with no
refund, no timeline, and nothing on the page telling them what happens next — until a human notices
on Monday.

The published promise is what makes this sharp. The shop advertised a decision moment and DiveDay
enforced it automatically; the half of the promise that involves giving money back is the half left
manual.

## Why it isn't already done

It needs a policy call I can't make, and the safe-looking default is not obviously the right one.

Refunding automatically on a shop-side cancellation is a *money* behaviour change on paths that today
move nothing, and it is exactly the class of change that should not be an engineering default. It
also cuts against a real preference some operators hold: a shop that blows out a Saturday often wants
to talk to the diver about next weekend before handing the money back, because a refund ends the
conversation and a rebooking continues it. The blow-out cascade is already built around that idea —
it offers each diver up to three alternatives they qualify for (`src/lib/blowout.ts`).

The counter-argument is that "we'll refund you when we get to it" is precisely the experience DiveDay
positions itself against, and that holding a captured card charge for a service the shop has already
cancelled is a consumer-protection question in most jurisdictions, not a preference. H-07 owns
refund policy and its recorded outcomes cover the diver-initiated case and the provider choice; the
shop-initiated case is not addressed anywhere in `docs/product/human-decisions.md`.

**Recommendation: refund automatically on both paths, unconditionally.** Specifically, that the
stated-window gate be *bypassed* rather than reused — a window is a rule about a diver changing their
mind, and it has no bearing on a trip the shop cancelled. A shop that would rather offer credit can
still do that after the money is back, and the diver is whole in the meantime.

## Proposed change

Answer the question first; the build follows from the answer.

**If "refund automatically":** add a shop-cancellation refund arm alongside
`refundBookingOnCancellation` in `src/db/refunds.ts` — same Stripe path and same connected-account
rule, but with no window/forfeit arithmetic and no `no_policy` short-circuit, because neither concept
applies when the shop cancelled. Call it from `callBlowout`'s phase two (which already walks every
booking outside the transaction and settles each row's status, so it is the right seam) and from
`cancelDeparturesBelowMinimum`'s sweep. Keep the existing degradation exactly: a counter/cash payment
or a disconnected account returns `manual` and lands on the staff queue, since there is no card to
reverse. The diver-facing mail should then say what actually happened rather than that the money is
safe.

**If "credit, not cash":** that is a larger build than it sounds — DiveDay has no credit or account
balance concept anywhere in `src/db/schema.ts` — and it should become a roadmap item with its own
ADR, not a quiet variation on the refund path.

**If "leave it staff-run":** then the two diver-facing messages must stop implying otherwise, and the
outstanding refunds need to be a visible queue rather than a thing staff remember. The Orders index
already hosts the stuck-payment-operations panel behind `canPersonManagePaymentSettings`; a
"cancelled, refund owed" list belongs beside it, and Today should mirror it as an `urgency: "now"`
row the way it already mirrors the other stale-able back-office queues.

Do **not** reuse `refundBookingOnCancellation` unchanged for either shop-side path. Its window
arithmetic is the specific thing that makes it wrong here, and calling it would silently forfeit
seats on exactly the divers who did nothing wrong.

## Prompt

```text
Decide and then implement what happens to a diver's money when DiveDay cancels their departure —
the weather blow-out and the below-minimum sweep — as opposed to when the diver cancels.

Read first:
  - docs/product/follow-ups/FU-20260813-shop-cancelled-departures-dont-refund.md (the full write-up)
  - src/db/blowouts.ts, especially the "No money moves here" docblock and phase two of the cascade
  - src/db/trips-minimum.ts and src/app/api/cron/minimum-seats/route.ts (the unattended sweep)
  - src/db/refunds.ts — refundBookingOnCancellation and why its window/forfeit arithmetic is built
    for the diver-at-fault case only
  - the H-07 row in docs/product/human-decisions.md (refund policy is H-07's, and the shop-initiated
    case is not addressed there)

The constraint that makes this non-obvious: do NOT simply call refundBookingOnCancellation from the
two shop-side paths. It gates on the shop having stated a cancellation window and returns no_policy
otherwise, and it applies forfeit arithmetic — both correct when a diver changes their mind, both
wrong when the shop cancelled. A shop-side refund needs its own arm with neither.

If the owner's answer is "refund automatically" (the recommendation), done means: both paths reverse
the Stripe charge through the shop's own connected account with no window gate; a counter/cash
payment or disconnected account still degrades to the staff queue exactly as today; the diver-facing
mail in both flows says what actually happened instead of "your money is safe"; and copy changes land
in BOTH locale bundles under src/i18n/locales/.

Tests travel with it: unit tests in src/db/blowouts.test.ts and src/db/trips-minimum.test.ts covering
a paid Stripe booking, a counter payment, an unpaid booking, and a disconnected account; plus an
e2e spec if a staff-visible surface changes. Run pnpm check, then the focused tests with
--reporter=dot. This is a money path — get a security-reviewer pass before merge per AGENTS.md.

Delete docs/product/follow-ups/FU-20260813-shop-cancelled-departures-dont-refund.md as part of the
change.
```
