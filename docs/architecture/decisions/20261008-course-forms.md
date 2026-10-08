# 20261008-course-forms — A course asks each student to sign the shop's own forms, per booking, and an unsigned one blocks boarding

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Agencies ask a training shop for more paperwork than the release. Each student signs a course
liability release for that course and a safe-diving-practices statement, and a minor's parent or
guardian signs too. Until now DiveDay had one place for a shop's legal words, the release
(`waiver_templates`). A shop that taught courses kept the rest on paper and checked it by hand on
the morning of the first pool session.

Constraints that shaped this decision:

- **DiveDay ships no agency text** (H-10). The words are the shop's own, pasted in, exactly as with
  the release (H-01, H-03: legal and medical wording stays English and is never reflowed).
- **Booking-time admission is weaker than boarding** (`src/lib/trip-admission.ts` against
  `src/lib/readiness.ts`). A student may always buy a place on a course before signing its forms.
- Forms are personal records. Export, erasure and merge have to treat them the way they treat
  signed releases (H-02).
- Whether an unsigned form should *block* a student or only *warn* is the owner's call, and it was
  not settled when this shipped.

## Decision

**Four tables** (`src/db/schema/course-forms.ts`), each carrying `shop_id`:

- `course_forms` is a form's identity. Delete is soft (`deleted_at`).
- `course_form_versions` is append-only. Saving changed text adds a version. Saving identical text
  adds nothing, using the release's normalisation (trimmed, newline- and Unicode-normalised).
- `course_form_requirements` lists the forms a course asks for, in order. It is soft-deleted and
  replaced as a set from the course editor.
- `course_form_records` holds one signature, **for one booking**. It snapshots the title, version
  number and body the student saw, the typed name, the signing method (`electronic` or `paper`,
  recorded by a staffer) and the guardian's name, relationship and timestamps.

**A form is satisfied per enrollment.** A record counts only if it is for the same shop, the same
booking, the same person and the *current* version, plus a guardian co-signature when the student
was a minor on the day they signed (ADR 20260907-guardian-co-signature, measured in the shop's
zone). `signatureSatisfies` in `src/lib/course-forms.ts` checks all of this and fails closed.
Signing a form on one course never carries over to the next course, so a new version asks every
student who has not boarded yet to sign again.

**Requirements are read live from the course**, not frozen onto a session the way its admission
rules are. Choosing a form on Open Water asks every booked student on every upcoming session.
That is the point of the act. Removing a form releases them.

**Where each step happens:**

- **Authoring** is on the waivers page, beside the release (`CourseFormsSection`). It is owner or
  manager work, gated like the release (`canPersonManageWaiverTemplates`).
- **Choosing** happens on each course's editor (`CourseFormsRequirement`, gated by
  `canPersonConfigureTrips`).
- **Signing** happens on `/ready/[token]/forms`, a sub-page of the booking's readiness capability.
  The readiness link already proves the enrollment. Minting a second token kind would add a
  capability without adding any proof. The page refuses a held seat (identity unconfirmed) the way
  the rest of `/ready` does, and its actions go through the same rate limit.
- **Delivery** reuses the release's send. When the release is already signed but forms are owed,
  `issueAndDeliverWaiver` sends the forms link instead of reporting "already signed" (email
  `readiness_link` with purpose `course_forms`, SMS, or a copy link).
- **On paper**: a staffer records a paper copy from the trip's Divers tab, with the guardian's
  name for a minor.

**The agency's standard forms are set up by title, empty.** Each course template can name the
forms its agency expects (`standardForms` in `src/content/course-templates.ts`), with the agency,
the product number and the URL where the agency names them. The PADI Instructor Manual 2021
(product 79173) gives Open Water the general release (10072) and the Standard Safe Diving
Practices Statement of Understanding (10060), and gives Advanced, Rescue and the specialties the
Continuing Education Administrative Document (10038). Creating a course from its template (the
catalog seed) or syncing a template update (`pullCourseTemplateUpdates`) runs
`attachStandardCourseForms`. That creates each listed form the shop has no live form for, matched
by title, and adds each to the end of the course's list. It never removes or reorders a form.

DiveDay ships **no wording**. The owner allowed shipping the agencies' text verbatim from an
official copy, but no complete verbatim copy could be obtained: the fetch tool returns at most
short quotations, and the two circulating copies of 10060 carry different revisions (2009 and
2015). So every standard form ships with an empty body. **A form with no text is asked of nobody**
(`courseFormAwaitingText`). `requiredCourseFormsForTrips` leaves it out, so it cannot be signed,
sent, owed or blocking. The waivers page marks it "Needs your text", and the course editor and the
course list say "Paste the agency's wording". Pasting the text in is a normal save, a new version
that names the staffer who saved it, and from that moment it is asked like any other form.

**Gating is one switch.** `COURSE_FORMS_BLOCK_BOARDING` in `src/lib/course-forms.ts` is `true`.
An unsigned required form then adds the `course_form_unsigned` blocker and the student reads as
Blocked, using the words in `src/i18n/readiness-labels.ts`. With the switch at `false`, the form
is still owed and still named on the roster as a warning line, but no student turns Blocked.
`trip-admission.ts` never reads the switch.

**Parity with releases:**

- Export: the shop export carries all four tables, and a diver export carries that diver's records.
- Erasure (`anonymizeDiver`) blanks the signed and guardian names and stamps `anonymized_at`.
- Merge moves a source diver's records to the survivor.
- Retention keeps them, outside `RETENTION_DAYS`, like the release records.

## Alternatives considered

- **More releases per shop**, one `waiver_templates` row per form. Rejected because the release is
  signed once per diver and held across trips ("Sign once"), while a course form belongs to one
  enrollment. Mixing the two would make every release query ask which kind it is reading.
- **Its own token kind** (`/forms/[token]`). Rejected because the readiness capability already
  proves the booking, and a second bearer URL would be one more capability to rate-limit, log
  carefully and revoke, with nothing gained.
- **Freezing the requirement onto each session** the way admission rules are. Rejected for now.
  A shop that adds a form wants it asked of the students already booked, and a removed form should
  stop blocking them. If a shop needs a session pinned, that can be a later decision.
- **Gating at booking time.** Rejected because admission may never refuse someone readiness would
  clear, and a form is signed after a student has a seat.

## Consequences

- A training shop's paperwork lives in the same place as the morning's other blockers. The roster
  says who owes which form, and the prep link takes the student straight to it.
- Editing a form's text sends every not-yet-boarded student back to sign. There is no "non-material
  edit" choice yet; the release has one (issue #790) and forms could take the same one later.
- Form records carry no integrity seal yet. The release's records do. Both are follow-ups, filed as
  issues, not gaps in this decision.
- When the switch is at warn-only, the prep page offers forms only through the sign step's blocker.
  The direct link that the send delivers still works.
