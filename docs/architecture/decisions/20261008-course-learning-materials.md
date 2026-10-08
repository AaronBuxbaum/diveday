# 20261008-course-learning-materials — Learning materials on the course, a staff tick on the seat

- **Status:** Accepted
- **Date:** 2026-10-08
- **Supersedes:** [20260815-course-roster-and-material-tracking](20260815-course-roster-and-material-tracking.md)

## Context

A course asks its students to do something before day 1, almost always the agency's eLearning.
The shop sent that link by hand, and nobody on the staff side could see who had done it. The
earlier proposal ([20260815-course-roster-and-material-tracking](20260815-course-roster-and-material-tracking.md))
answered with a `course_enrollment_progress` table, a four-state status, a pasted agency code and a
new roster tab. It was never accepted, and the request that brought this back asked for less: send
the materials automatically, and let staff mark per student that they are done.

H-10 still holds. No agency exposes a provisioning or completion API
([20260721-manual-certification](20260721-manual-certification.md)), so "done" is always a person's
word, never a fetched fact.

## Decision

1. **The materials are course content.** `courses.learning_materials` is an ordered jsonb list of up
   to `MAX_LEARNING_MATERIALS` rows, each a name, an optional `https:` link and an optional note,
   edited in the course editor beside the FAQ. `sanitizeLearningMaterials` refuses a link that is
   not `https:`, a row with no name, and anything over the caps; `readLearningMaterials` re-checks
   every stored row, so a bad link from an import or a hand fix loses its `href` and keeps its name.
2. **Templates seed names, never links.** A template with eLearning starts the course with a named
   material and a note. Agency URLs change and are the shop's to choose, so the shop adds the link.
   Template sync leaves the list alone (it is not in `COURSE_TEMPLATE_SYNC_FIELDS`): once copied, it
   is the shop's.
3. **Delivery rides what already sends.** The booking confirmation lists the materials with links.
   The 7-day reminder repeats them under "Before your first day" until a staffer ticks the seat.
   `/ready/[token]` shows the same list, every link `rel="noreferrer"` because that URL is a bearer
   capability.
4. **The tick is two columns on `bookings`.** `course_materials_done_at` and
   `course_materials_done_by_person_id`, paired by a check constraint. Written by
   `recordCourseMaterialsDone`, which is scoped by `shop_id`, refuses a departure with no course,
   and keeps the first stamp on a repeat tick. It sits on the departure's Divers tab beside Certify
   and Next step, with a "Materials not done" capsule on the name line. Any live staffer may tick it,
   like the next step.
5. **It informs, never gates.** Nothing in admission, readiness, the manifest or roll call reads the
   tick. Its only consequence is that a ticked seat no longer keeps the 7-day reminder alive
   (`reminderEarnsItsSend`'s `courseMaterialsDue`).
6. **A multi-day course's reminder lists each day it meets** (from `trip_schedule_days`), with
   date and hours in the shop's zone.

## Alternatives considered

- **The `course_enrollment_progress` table from the superseded proposal.** Rejected. One booking
  has one course, so a 1:1 table bought a join and a second lifecycle for two columns. The status
  enum's middle states ("assigned") have no sender: DiveDay now sends the materials with the
  confirmation, so every student is "assigned" by construction.
- **A pasted agency code per student.** Deferred. Nothing asked for it, and it is personal data
  with no reader yet.
- **Gate boarding on the tick.** Rejected. Shops let students finish theory on day 1, and a gate
  built on a human's checkbox would block real divers on a forgotten click.

## Consequences

- **Easy:** additive schema (one jsonb, two nullable columns), both exported in the shop CSV; the
  staff-attribution column is classified for diver merge like its next-step neighbour.
- **Commits us to:** copy that never implies the agency confirmed completion. The tick reads as
  the shop's own mark.
- **Escape hatch:** dropping the tick is two columns and one roster form. A later per-student agency
  code or skill sign-off is a new table referencing the booking, not a rewrite of this one.
