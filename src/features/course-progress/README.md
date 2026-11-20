# course-progress

Which outline sessions of a course each student has been ticked through (ADR
20261120-course-session-progress). The shop's own word, stamped with who and when; it informs and
never gates admission, readiness, the manifest or Certify.

## Owns

- `store.ts`: the per-student reader and the tick writer.

## Does not own

The schema (`course_session_progress`), the roster UI and the server action.

## Invariants

Every read and write is scoped by `shop_id`. A step must be one the course's outline names.
