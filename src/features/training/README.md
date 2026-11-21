# training

Courses: the catalog, enrollment gates, session progress, materials, and certifying a student.

## Owns

- Courses: `courses/`, `courses-page.ts`, `course-edit-page.ts`, `course-template-localization.ts`,
  `course-materials.ts`, `course-preview-gate.ts`, `course-counter-qr.ts`.
- Students: `course-ladder/`, `course-progress.ts`, `course-next-step.ts`, `course-pulse/`,
  `course-dependent-seats.ts`, `course-certified.ts`, `elearning-check.ts`,
  `referral-student.ts`, `referral-students.ts`.
- Plans: `training-plans.ts`, `training-plan-view.ts`, `training-allocation-plan.ts`.

## Does not own

Agency verification of cards (`certifications`), and the departures a course runs on (`trips`).

## Invariants

- An instructor-led session with no instructor fails closed; enrollment gates come from the course
  baseline and clear only on verified evidence; a course slug never shadows a staff route; a
  content edit never touches pricing, the cert gate or the agency age baseline; the roster orders
  by each course's own minimum level (ADR 20260805-remove-certification-paths).
- Course depth is a marker (`{depth18}`) resolved by the shop's unit; a broken marker is refused
  at save (ADR 20260814-course-depth-markers).
- Session progress (ADR 20261120-course-session-progress) is the shop's word, stamped with who and
  when; it informs and never gates admission, readiness, the manifest or Certify, and a step must
  be one the course's outline names.
