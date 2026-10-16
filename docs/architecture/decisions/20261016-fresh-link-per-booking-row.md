# 20261016-fresh-link-per-booking-row — A booking's page lists the diver's other days, and each row mails its own link

- **Status:** Accepted
- **Date:** 2026-10-16
- **Extends:** [20260804-seat-claim-links](20260804-seat-claim-links.md); decision H-132

## Context

A regular with three boats ahead holds three `/ready` links and no way between them, and last month's
log entry could not be had at all: find-my-booking mailed links for current bookings only (fifth-loop
ideas, item 38). A readiness URL *is* its capability, so rows that open the other bookings would turn
one forwarded link into the diver's whole history. The owner chose a fresh link per row, sent to the
email on file (H-132).

## Decision

1. **"Your days with {shop}" on a booking's page** (`src/app/ready/[token]/_components/YourDays.tsx`),
   under the thread on a current `/ready` and under the after-state on `/ready` after the dive. Never
   on `/recap`, whose link is forwardable. Upcoming seats, and the six newest past dive days,
   numbered as the recap stamps them.
2. **A row is a send, not a door.** "Email me the link" mails that day's own page to the address on
   file: a fresh readiness capability for an upcoming day, a signed recap link for a past one. No
   URL for another booking is ever rendered.
3. **The target is accepted only from the page's own list** (`planYourDayLink`): same shop, same
   person, not cancelled, live trip. A hand-made post naming any other booking is `unavailable`.
4. **Two budgets**, as the expired-link rescue spends them: per IP (`contextFor`), and per target
   booking, spent only once the plan says a send will happen.
5. **Not on a held seat**, whose holder may not be the person the seat matched (#2082), and not for a
   person with no email on file.
6. **Find-my-booking sends the latest log entry** when the address holds no current booking: one
   email, the newest dive day, at most once a day per booking (the delivery row is the guard, since a
   recap link is stateless), and only then spending the per-inbox budget.
7. The `readiness_link` notification gains two purposes, `other_day` and `log_entry`, so neither
   email says a link expired.

## Alternatives considered

- **Rows open the other bookings directly.** One leaked link reaches every day; H-132 declined it.
- **One digest email of every day.** Tells whoever triggers it the diver's whole history; the
  find-my-booking rule is one booking per mail.
- **Leave each booking separate.** The desk keeps taking "resend my link" calls.

## Consequences

- Any day is reachable from one page, at the cost of a trip to the inbox per day.
- A fresh capability per tap grows the booking's live set until `MAX_LIVE_CAPABILITIES_PER_PURPOSE`
  retires the oldest, which is the newest-link-wins behavior the capability table already has.
- Someone holding a diver's live link can trigger mail to that diver's own address about their other
  days, bounded by the two budgets, and sees those days' titles and dates: the feature, kept within
  one person's record in one shop.
