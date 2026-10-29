# H-125: Which price does a course session show?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Which price does a course session show?** A course session read one price on the schedule (the trip row's) and charged another (the course total): Nitrox read $150 and charged $345. Raised by the fourth UX review (2026-10-14), section 5, decision 4.

## Minimum outcome to record

The choice, and where it is said.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the project thread, "Do recommended decisions for each", taking the recommendation):** For a course session the course total is the price; every row reads it, and the trip editor stops holding its own price on a course session.

- Public schedule rows, the "Next boat with space" card, JSON-LD offers and embed widgets use `perDiverBookingPriceCents`; the staff week board, Today departures and open roll call use the same helper. The course-selected board builder shows the course total instead of a separate trip-price field. The trip editor does the same and clears any stored trip fee when staff next save its booking details. The shared trip writer enforces this for new one-off, series and copied departures. When the course has no instruction price, the builder and editor keep the trip fee available as the documented fallback; ordinary trip pricing is unchanged.

## Unblocks / follow-up

The trip schema keeps `trips.priceCents` for non-course departures and as the fallback fee for course entries without an instruction price. A course's own instruction price takes precedence, and the editor clears any separate fee when staff save booking details. Demo course-session seeds follow the same rule.

Part of the [human decision log](README.md#decision-register).
