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

1. **Schema.** `course_inquiries` gains `preferred_date` / `alternate_date` (both `date`, both
   nullable) and `date_flexible` (boolean). `course_id` becomes nullable, and the table gains a
   check that a row names either a course or a free-text `interest` — a request must be *about*
   something. Keep `timing` as it is: "any weekend in the autumn" is still a true answer and the
   dates do not replace it.
2. **Public surface.** Lift `CourseInquiry` out of the course folder into a shared component that
   takes what it is asking about (a course, or nothing) as a prop, and mount it on the schedule
   page under a heading in the spirit of "Nothing on a date that works?". Real `<input type="date">`
   fields for the preferred and alternate dates, with the free-text box kept for everything a date
   cannot say. Every string through `src/i18n/locales/<locale>/diver.json`, both locales in the same
   change.
3. **Staff surface.** A paged list at `/shop/[shopSlug]/requests` — `Pager` and `offsetPage`, like
   every other staff list (ADR 20260803-one-pagination-model) — registered in
   `src/lib/staff-destinations.ts` as a **secondary** destination, not a sixth primary tab (the dock
   ceiling is five). Group by requested date so "four people want the 12th" is the thing the page
   says. Add a `loading.tsx` and `export const instant = true`, and a row in
   `scripts/route-coverage.json` with its e2e spec and visual capture.
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

The constraint that makes this non-obvious: course_inquiries.course_id is currently NOT NULL, and a
dive request has no course. Make it nullable and add a check that a row names either a course or a
free-text interest, rather than inventing a second table — the rows are the same thing to a shop,
and one table means one erasure path (src/db/anonymize.ts), one export column set (src/db/export.ts)
and one staff list.

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
