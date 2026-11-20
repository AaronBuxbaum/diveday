# 20261120-course-session-progress — Which sessions of a course a student has been through

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

A course-led shop asked whether DiveDay keeps a student's progress through a multi-day course
(#4321). Until now the roster held one free-text next step per seat, the learning-materials tick,
the referral papers and Certify. An instructor picking up a student on day two, or a student who
misses the pool night, had nothing to read but the next-step line. Aaron's note on #4631: the
agencies' own records could feed this later through the browser extension.

## Decision

1. **One row per student, course and outline step**: `course_session_progress` (`shop_id`,
   `person_id`, `course_id`, `step_title`, `done_at`, `done_by_person_id`), unique on the first four.
   A step is a day of the course's own outline (`courses.schedule_days`), named by its title, so
   reordering the outline never moves a tick. A tick the outline no longer names stays on file and
   is simply not listed.
2. **It belongs to the student and the course, not one departure.** Ticked on the pool night, it
   shows on the open-water weekend, the way Materials done does.
3. **Taking a tick back deletes the row.** The act is small and stamped; there is no history to keep.
4. **The writer refuses a step the outline does not name**, and every read and write is scoped by
   shop. Any live staffer may tick, as with the materials tick.
5. **It informs, never gates.** Nothing in admission, readiness, the manifest, roll call or Certify
   reads it, and it is the shop's word, never agency evidence.
6. **Personal data follows the person**: the student's row moves on a diver merge, is deleted on
   erasure and is in the diver's own export; the staffer column is an actor that a merge leaves.

## Alternatives considered

- **Columns on `bookings`.** Rejected: progress spans several departures of one course.
- **An agency skill checklist.** Rejected: not ours to copy, and the outline is already the shop's.
- **A free list of ticks not tied to the outline.** Rejected: nothing to render the unticked steps.

## Consequences

- A course without an outline shows no progress control; the outline editor is the one place to
  add steps.
- Pulling completion from an agency through the extension would write the same rows.
