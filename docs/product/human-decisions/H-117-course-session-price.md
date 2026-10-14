# H-117: Which price does a course session show?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Which price does a course session show?** A course session read one price on the schedule (the trip row's) and charged another (the course total): Nitrox read $150 and charged $345. Raised by the fourth UX review (2026-10-14), section 5, decision 4.

## Minimum outcome to record

The choice, and where it is said.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the project thread, "Do recommended decisions for each", taking the recommendation):** For a course session the course total is the price; every row reads it, and the trip editor stops holding its own price on a course session.

- Public rows built by layer r4-1 (fourth review item 2): the schedule rows, the "Next boat with space" card, the JSON-LD offer and the embed widgets price a course session by `perDiverBookingPriceCents`. The staff rows and the trip editor's price field are layer r4-3's; this row flips to Implemented when that lands.

## Unblocks / follow-up

Layer r4-3: staff rows and the trip editor.

Part of the [human decision log](README.md#decision-register).
