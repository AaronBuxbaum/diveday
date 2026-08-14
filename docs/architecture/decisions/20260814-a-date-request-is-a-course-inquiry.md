# 20260814-a-date-request-is-a-course-inquiry — One table for "please run this on this day", and dates only alongside the surface that groups them

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Asking a shop to run something on a day that is not on the board is an ordinary request, and
DiveDay answered it in one place and badly.

**Courses had a form; dives had nothing.** `/s/<shop>/courses/<slug>` carried a composer that wrote
a `course_inquiries` row and mailed the shop. `/s/<shop>` — the schedule — had no equivalent, so a
diver who wanted a two-tank on the Saturday nobody scheduled had no path at all: the page showed the
dates that exist and stopped.

**The one form that existed could not express a date.** Its timing field was free prose, so the shop
received "any weekend in the autumn, maybe the 12th?" and read intent out of a sentence. Nothing
could sort by date, count how many people wanted the same weekend, or notice that four inquiries
would fill one boat — which is the entire reason a shop wants this data.

**A `preferred_date` column existed and was deliberately dropped** on 2026-08-12
(`drizzle/20260812044252_familiar_reavers`), with a stated cause: "the date picker beside 'When
suits you' implied a precision the answer never had — a diver's date is a request the shop replies
to, never a hold." That was right for what existed then: a lone picker whose output nobody at the
shop could read on screen.

**And nobody at the shop could read any of it.** `course_inquiries` had a writer, an erasure path,
and seed rows — and no staff surface anywhere under `src/app/shop/`. The only delivery was a
best-effort email; a lead that bounced, or landed while the owner was on a boat, was gone.

## Decision

**A date request is a `course_inquiries` row, and the dates come back only together with the staff
surface that groups by them.**

1. `course_inquiries.course_id` becomes **nullable**, the table gains `interest` (what an ordinary
   dive request is about, in the diver's words), and a check constraint —
   `course_inquiries_subject_present` — requires a row to name **either** a course or a non-empty
   interest. One table, because the rows are the same thing to a shop: a person, a way to reach
   them, what they can already do, and what they want.
2. `preferred_date` returns, with `alternate_date` beside it and a `date_flexible` flag. The
   alternate is what keeps the first one honest: a diver naming a workable day and a fallback is
   stating a range, not booking a slot. `timing` stays exactly as it was — the free-text box is
   still the only field that can hold "any weekend in the autumn".
3. `/shop/<shop>/requests` renders them **grouped by day**, and that surface is what justifies the
   columns. The grouping rules live once, in `src/lib/date-requests.ts`: one group per date a
   request actually named; a request appears in the group for its preferred date *and* its
   alternate, so a group's count is "people who could make this day" with a firm count beside it;
   a flexible request joins groups within a few days of a date it named rather than getting a
   bucket of its own; nothing is counted twice inside one group; a request with no date at all sits
   in one group at the foot. Each group's own link opens the schedule builder pre-dated.
4. One shared composer (`src/components/DateRequestForm.tsx`) serves both public surfaces, and one
   server action (`src/app/actions/inquiry.ts`) records both. The either-or is refused there in the
   diver's own words; the check constraint is the backstop, not the thing a diver meets.

## Alternatives considered

- **A second table for dive requests** — duplicates the erasure path (`src/db/anonymize.ts`), the
  export column set (`src/db/export.ts`) and the staff list, to express a difference that is one
  nullable foreign key.
- **Re-adding `preferred_date` on its own** — exactly what the 2026-08-12 migration undid. A date
  nobody groups by is a field; a date something groups by is a departure waiting to be scheduled.
- **Dropping `timing` now that there are date fields** — a date cannot say "any weekend this
  autumn", and that is the answer a diver most often has.
- **Folding this into the wait list or the last-minute deal list** — those answer "tell me when a
  seat frees on a departure that exists". This one asks for a departure to exist. A diver who asks
  for a date has not asked to be marketed to.
- **A sixth primary nav tab** — the dock holds five and the sixth slot is More
  ([20260813-more-is-the-shops-other-door](20260813-more-is-the-shops-other-door.md)). Requests is a
  "Run the shop" destination.

## Consequences

Easy: a shop can see that four people could make one Saturday and put a boat on it in two taps; one
erasure sweep, one export file and one staff list still cover every lead; and a request keeps its
prose alongside its dates.

Hard: `course_id` can no longer be assumed present anywhere downstream — the export's course-title
lookup and any future course-scoped read must handle null. Erasure deliberately leaves `interest`
and the dates in place: they carry no identity, and blanking `interest` on a course-less row would
turn an erasure into a constraint violation.

Escape hatch: if date requests ever grow state a shop works through (assigned, answered, converted
into a departure), that is a status column on this table before it is a second table — and if the
two kinds genuinely diverge in what a shop *does* with them, splitting means a new table plus the
three duplications above, which is the cost this decision is buying off.
