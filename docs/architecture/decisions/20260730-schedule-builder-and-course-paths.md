# 20260730-schedule-builder-and-course-paths — The schedule is the builder; the catalog owns progression

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

Two surfaces were shaped like reference material when the job they serve is editorial.

**The schedule board.** `/shop/[shopSlug]/schedule` rendered staff three read-only views of the same
departures: the diver-facing card list, a staff schedule board showing crew, and stat tiles above
both. Every change to the board — a second boat on Thursday, a trip sliding a day because of wind,
next week's copy of this week's charter — meant leaving for `/trips/new` and its full definition
form, or opening a trip and editing its details. The form is correct and stays; it is the wrong
instrument for the thing a shop does twenty times a season, which is *arranging* days rather than
defining dives.

**Course progression.** After a booking a diver's card could not clear, the trip page offered a
"ready to go deeper?" nudge. It picked the course to suggest with
`courses.find((c) => /advanced open water/i.test(c.title))` — a title match. A shop that names the
course "AOW", teaches SSI's "Advanced Adventurer", or wants to point a diver at a specialty first got
nothing at all, silently. There was no way for a shop to state the order it walks divers through its
own catalog, which is the thing every shop has an opinion about and no shop could express.

## Decision

**The staff schedule becomes the builder, and is the only board.** Departures group under their
shop-local day, and each row carries its own controls: *add* one inline under any day header (title,
date, times, seats, dives, optional course and site), *move* one to another day or time, *copy* one
forward, *remove* one. Each control posts one whole edit; the builder never holds a half-finished
draft, so closing the tab mid-thought has changed exactly what was already saved. Crew shows on the
row, which is what the separate staff schedule board existed to say — so that component and the
duplicate read-only card list are both deleted rather than kept beside it.

The builder is deliberately shallow. Dives, sites, requirements, crew assignment, conditions,
prices, and the roster all stay on the trip's own page, one click away on the title; `/trips/new`
stays for a priced trip or a repeating series. This surface answers *when is it and how many seats*
and nothing else.

Three rules on the mutations, all enforced in `src/db/trips.ts` under a row lock rather than in the
UI:

- **A move slides the whole shape.** Only the start moves; the end and every `trip_schedule_days`
  row shift by the same delta, so a two-tank morning stays three and a half hours and a three-day
  course stays three days with its gaps intact.
- **A copy takes the dive, not the day.** Title, description, course, capacity, planned dives and
  their sites, prices, and the cancellation window; never the roster, wait list, crew, conditions,
  or series membership. A duplicate is a fresh departure that looks like the old one.
- **A removal is for a departure that never happened.** Hard deletion requires no booking (cancelled
  ones included), no wait-list entry, and no roll-call event. Anything else is a *cancellation*
  (`setTripStatus`), which keeps the roster, the refund story, and the record that the day existed.
  A move refuses a trip with roll-call history for the same reason: the crew has begun counting
  heads, and re-dating a manifest already in progress is a falsified record, not a schedule edit.

**Certification paths are catalog data, and guidance only.** `course_paths` /
`course_path_steps` let a shop order its own courses into named progressions, built at
`/shop/[shopSlug]/courses/paths/[pathSlug]`. The whole rung list is rewritten as one unit on every
save, which is what lets `position` stay dense and 0-based and both unique indexes hold without a
deferred constraint — reordering is never a sequence of per-row swaps that could leave a gap behind.

A path never gates anything. Admission to a course remains that course's own
`minimum_certification_level`, and no query consults a path to decide whether a diver may enrol. What
a path decides is what a diver is *shown*: the trail on the public course page, and the suggestion
after a cert-blocked booking, which now reads off the shop's own ordering instead of a regex.

`nextPathStep` picks, among the rungs a diver could enrol in today, the one with the highest
admission bar — and only if that bar stands at least as high as the card they already hold. The
second half is the load-bearing part. DiveDay records the card a diver holds, never the courses they
have completed, so "have they done this already?" is not a question the data can answer; reading a
rung whose bar they have already cleared as *done* is the conservative guess. It can cost a shop a
suggestion it might have made. The other direction sells a diver a course they finished last season.

## Alternatives considered

- **Drag-and-drop scheduling.** The obvious reading of "builder", and rejected: a keyboard and a
  screen reader get a worse affordance, a wet thumb on a dock phone gets a much worse one, and the
  interaction needs client state for an operation that is one form post. Move and Copy take a date
  and a time, which is also what a staff member says out loud.
- **Keep the read-only list beside the builder.** Considered for one commit, then dropped: the same
  departures listed twice on one page is clutter a shop has to learn to ignore, and it made every
  "click the trip on the schedule" test ambiguous.
- **Infer progression from certification levels alone.** DiveDay could rank courses by their gate
  and offer the next rung with no shop input. Rejected — it is exactly the guess the title match was
  making, one layer more sophisticated, and it cannot express "we send our divers to Nitrox before
  Advanced," which is a real editorial position shops hold.
- **A path as an enrolment prerequisite.** Tempting (a shop could require Advanced before Wreck) and
  refused. Admission is a safety-adjacent rule with one home already; a second mechanism that can
  also block a seat means two places to look when a diver is refused, and eventually two answers.

## Consequences

- The board is now a working surface, and `pnpm e2e e2e/schedule-builder.spec.ts` covers the four
  mutations plus both refusals plus the role boundary (H-14: building the board is
  owner/manager/instructor work, re-checked against live roles on every action).
- `src/components/StaffScheduleBoard.tsx` and the schedule page's read-only staff list are gone.
  Specs that opened a trip by clicking its row go through `openTripFromBoard` in `e2e/helpers.ts`.
- Paths ride in the full-shop export as `course_paths.csv` and `course_path_steps.csv`, so the
  ordering a shop authored leaves with it like everything else.
- A path outlives a course the shop hides: staff still see the rung (with a warning), divers never
  do. A shop that deletes a course outright loses that rung by cascade.
- Follow-up, deliberately not built: a public page per path. The trail on the course page covers the
  diver-facing need today, and a new public route means new SEO, structured data, and public-route
  allowlist surface for a page nobody has asked for yet.

## Amendment 2026-08-05 — the certification-paths half is removed

Certification paths were deleted in full by
[20260805-remove-certification-paths](20260805-remove-certification-paths.md): the tables, the
builder, the two public pages that later grew, the export CSVs, and the course-page trail. The staff
roster now reads progression off each course's own `minimum_certification_level` instead. Everything
this ADR decided about **the schedule being the builder** stands unchanged and is not superseded;
only the catalog-owns-progression half is.
