# 20261017-one-interest-with-a-scope — One `interests` table for everyone who wants a seat

- **Status:** Accepted
- **Date:** 2026-10-17
- **Supersedes:** [20260814-a-date-request-is-a-course-inquiry](20260814-a-date-request-is-a-course-inquiry.md) and [20260816-trip-invitations-are-outreach](20260816-trip-invitations-are-outreach.md)
- **Amends:** [20260719-trip-waitlist](20260719-trip-waitlist.md) (party rule stands), [20260727-last-minute-fill-promos](20260727-last-minute-fill-promos.md) (the list half), [20260827-the-departure-is-two-working-surfaces](20260827-the-departure-is-two-working-surfaces.md) (the groups under Divers), [20260902-sender-standards-for-ses](20260902-sender-standards-for-ses.md) (mail class, H-20261005-one-interest-table-names), [20261005-optional-shop-features](20261005-optional-shop-features.md) (the switches gate scopes)

## Context

Four tables hold one fact, a person who wants a seat: the wait list, invitations, the last-minute list and course inquiries. Each has its own reader, grammar and mail class, and a date request that fits a departure never appears on it. Aaron chose option 4 of issue #2656. No backfill (H-20260815-no-legacy).

## Decision

**One table, `interests`, with a `scope`: `departure`, `date` (a day not on the board) or `anytime` (the last-minute list). Staff get one panel on every departure, Who wants in, and one act, Offer a seat.**

- Check constraints keep each scope's columns apart. A date interest may live on a snapshot alone (H-20260724-one-person-per-email); the others need a person or a parent interest.
- **Every offer is a departure row**, copied from a date or anytime interest with `parent_interest_id`. A diver who is waiting and then invited is one row.
- An interest reserves nothing. `bookings.ts` never reads or writes it; "booked" stays derived for departure interests, and only staff seating from an interest stamps `closed_as = 'booked'`, after the seat commits.
- `invitableSeats` ignores offers that carry a deal, so a blast never starves the wait-list roll.
- Offers inform and never gate (ADR 20260813): a ticked row below the bar may be offered with a warning, "everyone who fits" sends only to fits, the counter keeps its refusal. `readiness.ts` and `trip-admission.ts` are untouched.
- The Stripe deal (`trip_last_minute_promos`) stays; an offer carries it (`promo_id`).
- One held-send kind, `seat_offer`; two notification kinds split by mail class so the schema can require the unsubscribe link on one. Every commercial offer takes the 24 h cold-send window (#2133).
- Erasure keeps two modes under one `scope` branch: departure and anytime rows are deleted; date rows are blanked by person, email and fuzzy phone, with their departure children.
- The export's four CSVs become one `interests.csv` with a `scope` column.
- The concept is **Interest** (H-20261005-one-interest-table-names D-1): table, code and file names.
- **Mail class follows H-20261006-staff-trip-invitation-service's test** (H-20261005-one-interest-table-names D-2 option b): a seat on the departure the diver waited for, or the reply to their own date request, is service mail; everything the shop chose is commercial (`offerMailClass`, `src/lib/interests.ts`).

## Alternatives considered

- **A spine plus three detail tables** loses the one-table win.
- **`leads`**: collides with a booking's party lead.
- **Today's mail classes, mapped** (H-20261005-one-interest-table-names D-2 a): kept a diver-asked wait-list invite commercial, failing H-20261006-staff-trip-invitation-service's own test.

## Consequences

One row grammar, one held-send kind, one offer function. Every staff offer holds 8 s; a deal blast skips a diver offered cold that day. The deal sender moves to the Divers tab (D-3). The old tables are undeclared one release and dropped the next.
