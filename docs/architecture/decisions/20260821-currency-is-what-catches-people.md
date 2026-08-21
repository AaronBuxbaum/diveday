# 20260821-currency-is-what-catches-people — `/ready` asks when you last dived, and gates nothing on the answer

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

[20260820-attested-at-booking-verified-at-boarding](20260820-attested-at-booking-verified-at-boarding.md)
made a diver's stated certification level count at the sale. A `dive-domain-expert` review of that
decision agreed with the policy and named one gap it judged worth more than everything the gate does
catch:

> The claim that will hurt a Florida shop is not an inflated rung, it's an honest "Advanced Open
> Water" from 1998 with no dive since 2013.

Nothing in the product asked. The only currency signal anywhere was `certifications.expires_at` — the
shop's own refresher-due date, which by definition exists only on a card the shop already holds, and
therefore says nothing at all about the new customer the sale gate now judges on their own words.
That diver clears the sale, clears every readiness check the moment a staffer sights their card, and
arrives expecting a 30 m wreck.

The product owner's call was to build it into `/ready` rather than the booking form.

## Decision

**Ask "when did you last dive?" on `/ready`, in coarse bands, and gate nothing on the answer.**

- **A new column, `bookings.last_dived_band`**, over a five-value pgEnum: `this_season`,
  `within_a_year`, `one_to_five_years`, `over_five_years`, `never`. Null is "not said" — a real
  state, never a default that reads as a claim.
- **On the booking, not the person, and not in `certifications`.** Not a card: it does not expire,
  nothing verifies it, and no rung on `CertificationLevel` can express it. Not the person either,
  because currency is a fact *with a date on it* — an answer given in March is not evidence about a
  diver booking again in November, and a person-level column would quietly become one. "Their most
  recent answer" stays a query over their bookings rather than a stored value that silently goes
  stale.
- **Bands, not a date.** The answer is worth exactly as much as the diver's memory. Somebody who
  last dived "a few years back" cannot name the month, and a date field would invite them to invent
  one that then reads as precision nobody earned.
- **Asked on `/ready`, of everyone**, as a third non-blocker checklist row beside the emergency
  contact and gear. Not a field inside the certification disclosure: that disclosure only appears
  when the shop is holding nothing usable, and a diver whose card the shop verified four years ago
  is exactly the person worth asking.
- **`never` is a real answer** and distinct from the level question's "I'm not certified yet". A
  diver certified last month who has not been in open water since their course is precisely who a
  divemaster wants to know about.

**Nothing gates on it. There is no rank, no minimum, and no blocker.** `src/lib/dive-recency.ts`
deliberately exposes no comparison — only `diveRecencyIsNotable`, which decides a *tone*. A shop
seeing "Advanced Open Water · last dived over five years ago" beside a name is the entire value; a
refusal would be the software deciding a refresher question that belongs to a divemaster.

## What staff see, and where

The roster (`RosterSection`) renders the answer in the same warning tone the depth advisory uses —
outside the blocker list, because this diver boards.

**Only the two notable bands render there.** `one_to_five_years` is deliberately not one: two seasons
off is ordinary for a holiday diver, and tinting it would tint most of a Florida shop's winter
roster, which is how a signal stops being read. A line on every seat saying "last dived this season"
is the noise that would stop the other two being noticed.

The prep list and the diver record are named by the original follow-up and are **not** in this
change — both files were being restructured on concurrent branches the same day. That is recorded as
`FU-20260821-currency-on-the-prep-list-and-the-diver-record` rather than left implicit.

## Consequences

- Every booking taken before today is `null`, and stays that way. Silence is never rendered as a
  warning and never counted as a refusal to answer: `diveRecencyIsNotable(null)` is false by
  construction, with a test on it, because otherwise the whole existing roster would light up.
- The `/ready` checklist grows from two non-blocker rows to three, so the progress bar's denominator
  moves. That is the intended reading — it is a thing the diver can still do.
- A diver can revise their answer by picking a different band; there is no path back to "not said".
  An answer given is a thing the crew read, and erasing it would remove a fact a briefing may already
  have been built on.
- The seed carries two answers (`seed-dive-recency.ts`) so the warning treatment is something
  somebody has actually looked at, in both themes, rather than a branch only jsdom has rendered —
  the same argument `seed-self-declared.ts` makes for the self-declared card mark.

## Alternatives considered

**Ask it on the booking form, beside the level.** What the original follow-up proposed, and rejected
by the product owner in favour of `/ready`. The booking form is a checkout and every field on it is
paid for in abandoned carts; `/ready` is a page the diver returns to all week, where an unanswered
row is an invitation rather than an obstacle. It also means the question reaches divers whose seat was
booked *for* them — a party member, a walk-in a staffer seated — who never see the booking form at all.

**A dive count, or a logbook.** Explicitly not proposed by the review and not built. Both read as
verification of something nothing verifies, and a count invites precision the answer does not have.

**Gate a deep charter on currency.** Rejected outright. It would refuse divers a divemaster would
clear after two minutes of conversation, on the strength of a self-report — inheriting every weakness
of the attestation gate with none of its "refuse early, while they can still buy the right charter"
benefit, since by `/ready` the seat is already sold.
