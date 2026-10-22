# 20261017-one-lead-with-a-scope — One `leads` table for everyone who wants a seat

- **Status:** Proposed
- **Date:** 2026-10-17
- **Supersedes:** [20260814-a-date-request-is-a-course-inquiry](20260814-a-date-request-is-a-course-inquiry.md) and [20260816-trip-invitations-are-outreach](20260816-trip-invitations-are-outreach.md)
- **Amends:** [20260719-trip-waitlist](20260719-trip-waitlist.md) (party rule stands), [20260727-last-minute-fill-promos](20260727-last-minute-fill-promos.md) (the list half), [20260827-the-departure-is-two-working-surfaces](20260827-the-departure-is-two-working-surfaces.md) (the groups under Divers), [20260902-sender-standards-for-ses](20260902-sender-standards-for-ses.md) (mail class, H-145), [20261005-optional-shop-features](20261005-optional-shop-features.md) (the switches gate scopes)

## Context

Four tables hold one fact, a person who wants a seat: the wait list, invitations, the last-minute list and course inquiries, with two side tables. Each has its own reader, row grammar, hold behaviour and mail class, and a date request that fits a departure never appears on it. Issue #2656 offered four shapes; Aaron chose option 4. There are no real divers, so the migration has no backfill (H-49).

## Decision

**One table, `leads`, with a `scope`: `departure`, `date` (a day not on the board) or `anytime` (the last-minute list). Staff get one panel on every departure, Who wants in, and one act, Offer a seat.**

- Check constraints keep each scope's columns apart. A date lead may live on a snapshot alone (H-13); the others need a person or a parent lead.
- **Every offer is a departure row**, copied from a date or anytime lead with `parent_lead_id`. A diver who is waiting and then invited is one row.
- A lead reserves nothing. `bookings.ts` never reads or writes it; "booked" stays derived for departure leads, and only staff seating from a lead stamps `closed_as = 'booked'`, after the seat commits.
- `invitableSeats` ignores offers that carry a deal, so a blast never starves the wait-list roll.
- Offers inform and never gate (ADR 20260813): a ticked row below the bar may be offered with a warning, "everyone who fits" sends only to fits, the counter keeps its refusal. `readiness.ts` and `trip-admission.ts` are untouched.
- The Stripe deal (`trip_last_minute_promos`) and `trip_help_requests` stay; a deal is something an offer carries (`promo_id`).
- One held-send kind, `seat_offer`; two notification kinds split by mail class so the schema can require the unsubscribe link on one. Every commercial offer takes the 24 h cold-send window (#2133).
- Erasure keeps two modes under one `scope` branch: departure and anytime rows are deleted; date rows are blanked by person, email and fuzzy phone, with their departure children.
- The export's four CSVs become one `leads.csv` with a `scope` column.
- The name `leads` collides with a booking's *party lead*; the glossary keeps them apart (D-1, H-145).

## Alternatives considered

- **A spine plus three detail tables** gives back most of the "one table" win.
- **Interest as the name** avoids the collision; kept as the fallback in H-145.

## Consequences

One row grammar, one held-send kind, one offer function. About 30 columns of which a row uses 10 to 12. Every staff offer now holds 8 s, and a deal blast skips a diver offered cold that day. The deal sender moves to the Divers tab (D-3). The old tables are undeclared one release and dropped the next.
