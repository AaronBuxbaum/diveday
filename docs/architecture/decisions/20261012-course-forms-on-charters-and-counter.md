# 20261012-course-forms-on-charters-and-counter — Ask a course's forms on a charter seat staff mark as training, and sign students one at a time on a counter device

- **Status:** Accepted for decision 1 (the training mark, issue #2275, 2026-10-17); decision 2 (the counter hand-off) is still Proposed
- **Date:** 2026-10-12

## Context

Course forms (ADR 20261008-course-forms) are asked only on a course session. Two cases miss them
(issue #2275): an adventure dive done on an ordinary charter boards with none of the course's
forms checked, and a group at the counter with one tablet cannot sign one student after another.
A `dive-domain-expert` review's changes are folded in below.

## Decision

**1. A training dive on a charter is an explicit staff mark, never an inference.**

- `bookings.training_enrollment_booking_id` names the course seat (the enrollment) the dive counts
  toward, with who marked it and when. Owner, manager or instructor (`canConfigureTrips`) set it
  from the Divers tab. Valid only for the same diver's live, confirmed, diving course seat at the
  same shop, whose session ends no earlier than the charter leaves and has not ended. One
  enrollment per seat: a second mark is refused until the first is cleared.
- One resolver (`src/db/training-mark-resolve.ts`) maps a charter seat to its enrollment for every
  reader and writer. The seat is asked the enrollment's forms under its held-at-start rule, and
  reads and writes the enrollment's records, so signing once covers both.
- The blockers are the existing course-form ones. A mark that no longer holds at read (enrollment
  canceled, held or moved) is `training_mark_invalid` until staff clear it, never "no mark". Every
  mark and clear pushes the manifest, which refreshes the offline copy.
- Clearing a mark with forms owed, or one that no longer holds, takes `canManageWaiverTemplates`
  or the enrollment's instructor, rostered by another; the manifest names who did.
- "In training" is unchanged. **Amended 2026-10-17 (issue #2731, decided by Aaron):** a mark that
  stands, with the course's instructor aboard (someone who counts as the instructor in the water on
  the enrollment's session and on the charter), takes the course's own minimum level in place of the
  charter's and its sites'; specialty and nitrox gates are unchanged. With no such instructor the
  charter's level stands and the row and the manifest warn. The sale counts a course seat a mark
  could name, with that instructor already aboard, so admission never refuses a seat readiness would
  clear (`markableTrainingDiveLevels`, `src/db/training-mark-resolve.ts`).

**2. Counter hand-off (Proposed, not built).** A single-use, ten-minute `course_forms_counter`
capability per booking, never the emailed link. The device shows that student's forms, then "Hand
the device back" with no way back. The next student is opened from the staff side (a PIN step-up
or the staffer's own device). Records name the staffer who handed over.

## Alternatives considered

- **Infer training from an open enrollment.** Rejected: a student fun-diving between sessions is
  not training, and a wrong inference blocks boarding.
- **Copy the forms onto the charter booking.** Rejected: it breaks "satisfied per enrollment".
- **Several enrollments per seat.** Rejected for now: one dive counts toward one course.
- **A kiosk mode on the staff session.** Rejected: a student holding a logged-in staff device can
  reach every record.

## Consequences

- Five booking columns and one resolver; no new dependency.
- A marked dive takes the course's minimum level only while the course's instructor is aboard
  (amendment above). Revisit if shops need several courses on one dive.
