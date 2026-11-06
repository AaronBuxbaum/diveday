# 20261016-fresh-link-per-booking-row — A booking's page lists the diver's other days, and each row opens its own page

- **Status:** Accepted
- **Date:** 2026-10-16
- **Amended by:** [20261104-derived-booking-link-tokens](20261104-derived-booking-link-tokens.md) — a send mails the one live link; issue #4059 (2026-11-06) — a row opens its day instead of mailing it.
- **Extends:** [20260804-seat-claim-links](20260804-seat-claim-links.md); decision H-20261014-other-days-send-fresh

## Context

A regular with three boats ahead holds three `/ready` links and no way between them, and last month's
log entry could not be had at all: find-my-booking mailed links for current bookings only (fifth-loop
ideas, item 38). The owner first chose a fresh link per row, sent to the email on file
(H-20261014-other-days-send-fresh). The defensive-choices audit (Aaron, 2026-11-06) found the trip
to the inbox cost more than it protected: the threat is someone learning another person's days at
one shop, from a link that person was mailed.

## Decision

1. **"Your days with {shop}" on a booking's page** (`src/app/(token)/ready/[token]/_components/YourDays.tsx`),
   under the thread on a current `/ready` and under the after-state on `/ready` after the dive. Never
   on `/recap`, whose link is forwardable. Upcoming seats, and the six newest past dive days,
   numbered as the recap stamps them.
2. **A row opens its day** (`openYourDay`, #4059): "Open" redirects to that day's own page, its one
   live delivered readiness link for an upcoming day, a signed recap link for a past one. Nothing
   is mailed.
3. **The target is accepted only from the page's own list**: same shop, same person, not
   cancelled, live trip. A hand-made post naming any other booking opens nothing.
4. **One budget**: per IP (`contextFor`).
5. **Only on a delivered link** (`booking_capabilities.delivered`, security review r5-4 F1): one
   mailed to the contact on file, never a booking's or seat claim's redirect. Not on a held seat
   (#2082), nor with no email on file.
6. **Find-my-booking sends the latest log entry** when the address holds no current booking: one
   email, the newest dive day, at most once a day per booking (the delivery row is the guard, since a
   recap link is stateless), and only then spending the per-inbox budget.
7. The `readiness_link` notification gains two purposes, `other_day` and `log_entry`, so neither
   email says a link expired.

## Alternatives considered

- **Each row mails its link** (the first version). A trip to the inbox per day, for a risk nobody
  named a victim of.
- **One digest email of every day.** Tells whoever triggers it the diver's whole history.
- **Leave each booking separate.** The desk keeps taking "resend my link" calls.

## Consequences

- Any day is one tap from a mailed page.
- Whoever holds a diver's mailed link reaches that diver's other days at the same shop: the
  feature, kept within one person's record in one shop.
