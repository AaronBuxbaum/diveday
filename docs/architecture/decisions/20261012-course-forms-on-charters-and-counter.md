# 20261012-course-forms-on-charters-and-counter — Ask a course's forms on a charter seat staff mark as training, and sign students one at a time on a counter device

- **Status:** Proposed (design note for issue #2275; needs a `dive-domain-expert` review before any code)
- **Date:** 2026-10-12

## Context

Course forms (ADR 20261008-course-forms) are asked only on a course session. Two cases miss them
(issue #2275): an adventure dive done on an ordinary charter boards with none of the course's
forms checked, and a group at the counter with one tablet cannot sign one student after another.
Admission (`trip-admission.ts`) never reads either; boarding (`readiness.ts`) blocks.

## Decision

**1. A training dive on a charter is an explicit staff mark, never an inference.**

- A nullable `bookings.training_enrollment_booking_id` names the course-session booking (the
  enrollment) that the charter seat's dive counts toward. Only staff set or clear it, from the
  charter's Divers tab, gated by `canPersonConfigureTrips`. The target must be the same shop and the
  same person, a live seat on a session of a course, and not ended.
- `requiredCourseFormsForBookings` asks a marked seat for the enrollment course's forms, under the
  enrollment session's held-at-start rule. Signatures stay on the enrollment booking ("satisfied
  per enrollment"), so the charter seat reads the enrollment's records: signing once covers both.
- The blockers are the existing `course_form_unsigned` and `course_form_guardian_missing`.
- Cancelling the enrollment clears nothing by itself. The charter seat then shows a "training for a
  cancelled course" warning for staff to resolve; boarding is never silently relaxed.

**2. Counter hand-off: one staff-issued capability per student, and a dead end after signing.**

- On a session's Divers tab, staff choose the students to sign at the counter. Each "Sign now" mints
  a single-use `course_forms_counter` capability bound to one booking. It lasts 10 minutes and is
  revoked when used.
- The device opens `/ready/[token]/forms` under that token. The page shows only that student's
  forms and refuses every other `/ready` door, like the forms-only link.
- After submitting, the page shows "Hand the device back" and nothing else. It has no link, no
  name and no back route to the staff list. The next student's page is minted from the staff
  surface, which needs the staffer's session.
- The record's method is `typed_consent`, and `recorded_by_person_id` names the staffer who issued
  the token. A guardian co-signs on the same page.

## Alternatives considered

- **Infer training from the diver's open enrollment.** Rejected: a student on a fun dive between
  sessions is not training, and a wrong inference blocks boarding.
- **Copy the forms onto the charter booking.** Rejected: it breaks "satisfied per enrollment".
- **A kiosk mode on the staff session.** Rejected: a student holding a logged-in staff device can
  reach every record.

## Consequences

- One column, one capability purpose and one per-booking reader. No new dependency.
- Open for review: whether a shop needs a staff step-up (a PIN) before minting a counter token, and
  whether a marked seat should also show the enrollment's medical answers to the charter's crew.
