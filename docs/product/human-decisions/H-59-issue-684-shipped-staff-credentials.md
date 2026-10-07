# H-59: Issue #684 shipped staff_credentials as recorded evidence plus a quiet renewal/lapse clock (staffing roster,…

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

Issue #684 shipped `staff_credentials` as recorded evidence plus a quiet renewal/lapse clock (staffing roster, Today), both explicitly informational. Slice 3 (issue #983) asks: should a lapsed credential ever narrow `inWaterCrewRole`'s in-water ratio count, refuse a new crew assignment, or refuse a new booking sale?

## Minimum outcome to record

A yes/no per gate (ratio narrowing, new-assignment refusal, new-sale refusal), and if yes, which credential kinds and any grace window.

## Unblocks / follow-up

**Decided "inform only," permanently, 2026-08-25 (Aaron Buxbaum):** a locally recorded renewal date is not reliable enough to silently narrow legal capacity or refuse a valid assignment or sale — there is no issuer-status integration and no "current as of" confirmation model. `staff_credentials` stays exactly as slices 1–2 shipped it: warning-only evidence on the staffing roster and a Today row. `inWaterCrewRole` (`src/lib/crew-roles.ts`), `courseRatioCapacity` (`src/lib/course-ratios.ts`), and `createBookingRecord` (`src/db/bookings.ts`) never read credential status, and this is the closed answer, not a placeholder awaiting a later gate — see the `staffCredentials` table comment in `src/db/schema.ts`. **Amended 2026-10-07 (Aaron Buxbaum, issue #1853, shape (b)), carrying out the 2026-09-16 ruling on #1680 ("read the credential where the ratio is computed"): the ratio-narrowing gate is reopened for the supervision claim only, and the other two stay closed.** `inWaterCrewRole` (`src/lib/crew-roles.ts`) now narrows a rostered professional by the rungs their recorded ratings have lapsed off on the departure's last shop-local day (`lapsedRungs`): a rung is lapsed only when at least one `instructor_rating` / `divemaster_rating` row evidences it **and every one** renewed before that day, so no rating recorded, a rating with no renewal date, and one current card among several all still count, and a rating renewing on the morning of the dive counts for that dive. Today, the staffing week and the trip page read that narrowed count (`courseCrewCountsByTrip`, `getTripOverview`) and each says who lapsed beside the gap it opened rather than showing one more shortfall. **New-sale and new-assignment refusal stay closed, permanently, as this row first decided:** `tripCourseCrewCounts` (`src/db/bookings.ts`) — the `course_unstaffed` refusal, the course seat cap, the no-show seat hand-back — and the crew editor's "a course keeps an instructor" refusals (`src/db/trips-crew.ts`) pass no lapse and count the roster's claim, so a shop whose instructor renewed last week and has not updated DiveDay still sells Saturday's seat and sees the gap, worded, where it can fix the record.

Part of the [human decision log](README.md#decision-register).
