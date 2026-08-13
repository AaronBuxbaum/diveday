# FU-20260813-request-a-date-for-a-course-or-dive — Let a diver ask for a *date*, for a dive as well as a course, and give the shop somewhere to read it

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/dive-booking-ui-refinements-t5eoy6`, item 10 of a
  product-owner review list ("We need a better way for divers to request a date for a specific
  course or dive"). Every other item on that list shipped on this branch; this one did not.
- **Kind:** half-done
- **Effort:** L
- **Touches:** `src/db/schema.ts`, `src/db/course-inquiries.ts`,
  `src/app/s/[shopSlug]/courses/[slug]/_components/CourseInquiry.tsx`,
  `src/app/s/[shopSlug]/courses/[slug]/actions.ts`, `src/app/s/[shopSlug]/page.tsx`,
  `src/lib/course-inquiry.ts`, `src/app/shop/[shopSlug]/`

## What I noticed

Asking a shop to run something on a date that is not on the board is a real, common request, and
DiveDay answers it in exactly one place and badly.

**Courses have a form; dives have nothing.** `/s/<shop>/courses/<slug>` carries `CourseInquiry` — a
genuine lead capture that writes a `course_inquiries` row and mails the shop. `/s/<shop>` (the
schedule) has no equivalent. A diver who wants a two-tank charter on the Saturday nobody scheduled
has no path at all: the schedule shows the dates that exist and stops.

**The one form that exists cannot express a date.** Its timing field is free prose —
`courseInquiries.timing`, labelled "When suits you?" with the placeholder "the week of 12 August".
So the shop receives "any weekend in the autumn, maybe the 12th?" and has to read intent out of a
sentence. Nothing can sort leads by date, count how many people want the same weekend, or notice
that four separate inquiries would fill one boat — which is the whole reason a shop wants this
data.

**A date column was tried, and dropped on 2026-08-12 — read that reasoning before re-adding one.**
`drizzle/20260812044252_familiar_reavers/migration.sql` removes `course_inquiries.preferred_date`
with a stated cause: "the date picker beside 'When suits you' implied a precision the answer never
had — a diver's date is a request the shop replies to, never a hold". That was right *for what
existed at the time*: a lone picker on a form whose output nobody at the shop could read on screen.
A date only stops being false precision once something groups by it — "four people want the 12th"
is a departure waiting to be scheduled, where one person's `preferred_date` sitting in a row nobody
reads is just a field. So the dates come back **with** the staff surface, or not at all; adding the
column again on its own would re-make the mistake that migration undid.

**Nobody at the shop can read them on screen.** `course_inquiries` has a writer
(`recordCourseInquiry`), an erasure path (`src/db/anonymize.ts`), seed rows
(`src/db/seed-course-inquiries.ts`) — and no staff surface anywhere under `src/app/shop/`. The only
delivery is a best-effort email to the shop's inbox. A lead that bounces, or that lands while the
owner is on a boat, is gone.

## Why it isn't already done

Scope and honesty about size. It is three changes stacked — a schema change (dates, and making
`course_id` nullable so a *dive* request can share the table), a new public surface on the schedule
page, and a new staff surface with paging — each of which independently deserves its own review, and
the last of which is a new `/shop/**` destination and therefore a `staff-destinations.ts` decision.
Doing it in the same pass as fourteen other items would have meant a schema migration and a new
route with the thinnest possible tests, which is the wrong trade on a table that holds names, email
addresses and phone numbers.

There is also one genuine product question inside it that I would not answer alone: **does a date
request belong in `course_inquiries` at all, or is it its own table?** Recommendation: reuse the
table and make `course_id` nullable. The rows are the same thing from the shop's point of view — a
person, a way to reach them, what they can already do, and what they want — and one table means one
erasure path, one export column set, and one staff list. Splitting them would duplicate all three to
express a difference (course vs. dive) that is a single nullable foreign key.

## Proposed change

1. **Schema.** `course_inquiries` gains four nullable columns and loses one `NOT NULL`:
   - `preferred_date` and `alternate_date` (`date`) — **re-adding** the column dropped on
     2026-08-12, which is only justified together with step 3. `alternate_date` is what makes the
     first one honest: a diver with one workable date and one fallback is stating a range, not
     booking a slot.
   - `date_flexible` (`boolean`, default false) — "any of these, or near them".
   - `interest` (`text`) — what an ordinary *dive* request is about ("a two-tank on the wrecks"),
     since it has no course to name. This column does not exist today; add it in the same
     migration, before the constraint below can reference it.
   - `course_id` becomes nullable, and the table gains a check that a row names **either** a course
     **or** a non-empty `interest` — a request must be about something.

   Keep `timing` exactly as it is. "Any weekend in the autumn" is still a true answer, the dates do
   not replace it, and the 2026-08-12 migration's point stands: the free-text box is the one field
   that can hold what a diver actually means.
2. **Public surface.** Lift `CourseInquiry` out of the course folder into a shared component that
   takes what it is asking about (a course, or nothing) as a prop, and mount it on the schedule
   page under a heading in the spirit of "Nothing on a date that works?". Real `<input type="date">`
   fields for the preferred and alternate dates, with the free-text box kept for everything a date
   cannot say.

   **On the schedule page the component has no course, so it must ask what the request is about** —
   a short free-text "What would you like to dive?" that writes `interest`. Validate the
   either-or in the server action before insert (a course id from the page, or a non-empty
   `interest`), so the check constraint is a backstop rather than the thing a diver meets. Every
   string through `src/i18n/locales/<locale>/diver.json`, both locales in the same change.
3. **Staff surface.** A paged list at `/shop/[shopSlug]/requests` — `Pager` and `offsetPage`, like
   every other staff list (ADR 20260803-one-pagination-model) — registered in
   `src/lib/staff-destinations.ts` as a **secondary** destination, not a sixth primary tab (the dock
   ceiling is five). Add a `loading.tsx` and `export const instant = true`, and a row in
   `scripts/route-coverage.json` with its e2e spec and visual capture.

   **Grouping, stated precisely, because three date fields do not group themselves.** One group per
   calendar date. A request appears in the group for its `preferred_date` **and** in the group for
   its `alternate_date` when it has one — a shop deciding whether to put a boat on the 12th wants
   everyone who could make the 12th, not only those who named it first. Each group's headline count
   is therefore "people who could make this date", which is what a shop counts a boat against;
   render the alternate-date appearances in a lighter weight so a group of "3, one of them a second
   choice" cannot be misread as three firm asks. `date_flexible` requests join every group within
   a few days of a named date rather than getting a bucket of their own — a bucket labelled
   "flexible" is a list nobody schedules from. Requests with no date at all (free-text `timing`
   only) sit in one "no date named" group at the foot, which is where the prose that a date field
   cannot hold ends up. Nothing is counted twice *within* one group.
4. **Tests.** Unit tests for the writer and the grouping; one `e2e/` spec covering a diver asking
   for a date from the schedule page and a staffer reading it; a `e2e/visual.spec.ts` capture of the
   staff list.

Do **not** wire this into the wait list or the last-minute deal list. Those answer "tell me when a
seat frees on a departure that exists"; this answers "please create a departure". Conflating them
was considered and rejected — a diver who asks for a date has not asked to be marketed to.

## Prompt

```text
Add "request a date" to DiveDay: a diver can ask a shop to run a specific course *or* an ordinary
dive on a date that is not on the schedule, and shop staff can read those requests on screen.

Read first, in this order:
  - docs/product/follow-ups/FU-20260813-request-a-date-for-a-course-or-dive.md (the full write-up;
    its "Proposed change" section is the spec)
  - src/app/s/[shopSlug]/courses/[slug]/_components/CourseInquiry.tsx and its sibling actions.ts —
    the form that exists today and the server action behind it
  - src/db/course-inquiries.ts and the courseInquiries table in src/db/schema.ts
  - src/lib/staff-destinations.ts (read the "five primary tabs, six is the ceiling" note in
    AGENTS.md before adding a destination)
  - src/components/Pager.tsx and src/db/paging.ts — every paged staff list wears these
  - the schema-change, new-feature, i18n-copy and e2e-and-visual skills

Two constraints make this non-obvious, and both are easy to miss:

  1. course_inquiries.course_id is currently NOT NULL, and a dive request has no course. Make it
     nullable and add a check that a row names either a course or a free-text `interest` (a column
     that does not exist yet — add it), rather than inventing a second table. The rows are the same
     thing to a shop, and one table means one erasure path (src/db/anonymize.ts), one export column
     set (src/db/export.ts) and one staff list.
  2. A `preferred_date` column existed and was DELIBERATELY DROPPED on 2026-08-12 — read
     drizzle/20260812044252_familiar_reavers/migration.sql, which states why. Do not re-add it as a
     lone field. It is only justified alongside the staff surface that groups by it; the follow-up
     explains the distinction.

Done means: a diver can ask from /s/<shop> as well as from a course page, with real date fields;
staff have a paged /shop/<shop>/requests grouped by requested date, reachable from the destination
registry as a secondary (never a sixth primary tab); every string comes from
src/i18n/locales/<locale>/diver.json or a staff/<namespace>.json, in BOTH locales; the new route has
a loading.tsx, `export const instant = true`, and a row in scripts/route-coverage.json.

Tests travel with it: unit tests for the writer and the date grouping, one e2e spec for the diver
and staff halves of the flow, and a capture in e2e/visual.spec.ts.

Run: pnpm check, then pnpm e2e <your new spec> --reporter=line. Look at the new surfaces in light
and dark before calling it done (node scripts/screenshot.mjs).

Delete docs/product/follow-ups/FU-20260813-request-a-date-for-a-course-or-dive.md as part of the
change.
```
