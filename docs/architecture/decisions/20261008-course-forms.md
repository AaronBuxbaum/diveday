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
- Whether an unsigned form should *block* a student or only *warn* is the owner's call. The owner
  chose block.

## Decision

**Four tables** (`src/db/schema/course-forms.ts`), each carrying `shop_id`:

- `course_forms` is a form's identity. Delete is soft (`deleted_at`).
- `course_form_versions` is append-only. Saving changed text adds a version. Saving identical text
  adds nothing, using the release's normalisation (trimmed, newline- and Unicode-normalised).
- `course_form_requirements` lists the forms a course asks for, in order. It is soft-deleted and
  replaced as a set from the course editor.
- `course_form_records` holds one signature, **for one booking**. It snapshots the title, version
  number and body the student saw, the course title, the session (`trip_id`) and its instructors'
  names, the typed name, and the guardian's name, relationship and timestamps. The signing method
  is the release's vocabulary (`src/lib/signatures.ts`): `typed_consent` when the student signed on
  their own link, `in_person_attested` when a staffer recorded a paper copy (and then
  `recorded_by_person_id` names who), and `in_person_attested_namesake` when the staffer attested a
  guardian whose name reads as the student's. A paper copy may carry the date written on it
  (`paper_signed_on`).

**Placeholders are filled at signing.** A form's text may say `{shopName}`, `{courseTitle}` and
`{instructorNames}` where an agency form leaves a blank. `fillCourseFormText` fills them from the
enrollment (the instructors are the session's rostered crew in the instructor role) on the page the
student reads and in the record's `form_body`, beside the values themselves, so renaming a course
or changing a crew never rewrites what was agreed to. Any other brace is left as typed.

**A form is satisfied per enrollment.** A record counts only if it is for the same shop, the same
booking, the same person and a version the session asks for, plus a guardian co-signature when the
student was a minor on the day they signed (ADR 20260907-guardian-co-signature, measured in the
shop's zone, or on the paper's own date when staff gave one). `signatureSatisfies` in
`src/lib/course-forms.ts` checks all of this and fails closed. Signing a form on one course never
carries over to the next course.

A minor's signature without a guardian is its own blocker, `course_form_guardian_missing`, because
the fix is the guardian's signature rather than the student's. When it comes, the guardian columns
of the standing record are filled once and never overwritten. This is the case of a date of birth
that reached the shop after the student signed.

**Requirements are read live until a session starts, then held.** Before `starts_at`, a session
asks for the course's current list at each form's current version: choosing a form on Open Water
asks every student on every upcoming session, and removing one releases them. Once a session has
started, `requiredCourseFormsForTrips` holds it to what it started with. A form added to the course
afterwards is not asked of it. A signature on the version that was current when it began still
counts (`alsoAccepted`), so an edit made on day two of a three-day course asks the next session to
sign, never the students already in the water. A student who has not signed yet signs the current
words. Once a session has ended, nothing more is signed or recorded for it.

**Where each step happens:**

- **Authoring** is on the waivers page, beside the release (`CourseFormsSection`). It is owner or
  manager work, gated like the release (`canPersonManageWaiverTemplates`). Before a save, each
  form says how many students on how many sessions not yet started a new version would ask to sign
  again (`courseFormResignImpact`), as the release's editor does before a material change.
- **Choosing** happens on each course's editor (`CourseFormsRequirement`). Adding and reordering
  are gated by `canPersonConfigureTrips`. **Taking a form off** is a signature the shop stops
  collecting, so it needs `canPersonManageWaiverTemplates`: an instructor may add a form, never
  drop one. The editor says beforehand how many students on how many upcoming sessions a form
  added now would ask (`courseUpcomingEnrollment`).
- **Signing** happens on `/ready/[token]/forms`. Two capabilities open it. The diver's own
  readiness link already proves the enrollment. The **forms-only link** (`course_forms`) is what
  staff copy or send when the release is signed and the forms are not. It opens this page and signs
  there (`verifyCourseFormsLink`), and every other `/ready` door refuses it, so a link handed over
  the counter cannot read or change the diver's trip prep. A live one is **reused, not reissued**
  (the waiver link's rule, ADR 20260820-waiver-links-are-reused-not-reissued): the row keeps a copy
  of the token sealed under `SECRET_ENCRYPTION_KEY` (`booking_capabilities.token_sealed`, this
  purpose only, nulled on revocation), and a second send hands back the same URL. The page refuses
  a held seat (identity unconfirmed) the way the rest of `/ready` does, and its action goes through
  the same rate limit.
- **Delivery** reuses the release's send. When the release is already signed but forms are owed,
  `issueAndDeliverWaiver` sends the forms-only link instead of reporting "already signed" (email
  `readiness_link` with purpose `course_forms`, SMS, or a copy link).
- **On paper**: a staffer records a paper copy from the trip's Divers tab. They tick that they hold
  the signed copy and may give the date written on it; a minor's form names the guardian. A held
  seat is refused (the paper could be somebody else's signature), as is a session that has ended.

**The agency's standard forms are set up by title, empty.** Each course template can name the
forms its agency expects (`standardForms` in `src/content/course-templates.ts`), with the agency,
the product number and the URL where the agency names them. The PADI Instructor Manual 2021
(product 79173) gives Open Water the general release (10072) and the Standard Safe Diving
Practices Statement of Understanding (10060), and gives Advanced, Rescue and the diving
specialties the Continuing Education Administrative Document (10038), which does not include the
medical questionnaire. Discover Scuba Diving, ReActivate, Divemaster, Emergency Oxygen Provider
and Equipment Specialist list none until the manual's own sections are read for each (issue
#2264). Creating a course from its template (the catalog seed) runs `attachStandardCourseForms`.
That creates each listed form the shop has no live form for, matched by title, and adds each to the
end of the course's list. It never removes or reorders a form.

**A template sync never undoes the shop's no.** The template snapshot a course keeps
(`source_template_snapshot.standardForms`) records which forms that version named. A sync that keeps
the shop's edits (`pullCourseTemplateUpdates`, `preserve-shop-edits`) sets up only the forms new in
the incoming version. In either mode, a form the course once listed and the shop took off (a
soft-deleted requirement) stays off.

DiveDay ships **no wording**. The owner allowed shipping the agencies' text verbatim from an
official copy, but no complete verbatim copy could be obtained: the fetch tool returns at most
short quotations, and the two circulating copies of 10060 carry different revisions (2009 and
2015). So every standard form ships with an empty body. **A form with no text is asked of nobody**
(`courseFormAwaitingText`). `requiredCourseFormsForTrips` leaves it out, so it cannot be signed,
sent, owed or blocking. The waivers page marks it "Needs your text", and the course editor and the
course list say "Paste the agency's wording". Pasting the text in is a normal save, a new version
that names the staffer who saved it, and from that moment it is asked like any other form.

**Gating is one switch.** `COURSE_FORMS_BLOCK_BOARDING` in `src/lib/course-forms.ts` is `true`.
An unsigned required form then adds the `course_form_unsigned` blocker (or
`course_form_guardian_missing`) and the student reads as Blocked, using the words in
`src/i18n/readiness-labels.ts`. With the switch at `false`, the form is still owed and still named
on the roster as a warning line, but no student turns Blocked. `trip-admission.ts` never reads the
switch.

**Parity with releases:**

- Export: the shop export carries all four tables, and a diver export carries that diver's records.
- Erasure (`anonymizeDiver`) blanks the signed and guardian names and stamps `anonymized_at`.
- Merge moves a source diver's records to the survivor.
- Retention keeps them, outside `RETENTION_DAYS`, like the release records.

## Alternatives considered

- **More releases per shop**, one `waiver_templates` row per form. Rejected because the release is
  signed once per diver and held across trips ("Sign once"), while a course form belongs to one
  enrollment. Mixing the two would make every release query ask which kind it is reading.
- **Handing over the readiness link** for the forms, as the first version did. Rejected in review:
  the link staff copy at the counter, or send to a parent, would also open the diver's whole trip
  prep (fit, contacts, payment, cancellation) to whoever it reached. The forms-only purpose costs
  one enum value and keeps that door shut.
- **Reading requirements live through a session.** Rejected in review: an edit made mid-course
  turned students already in the water to Blocked on the morning of their last dive. A session now
  keeps the forms and versions it started with.
- **Freezing the requirement onto each session at booking**, the way admission rules are. Rejected:
  a shop that adds a form before a session starts wants it asked of the students already booked.
- **Gating at booking time.** Rejected because admission may never refuse someone readiness would
  clear, and a form is signed after a student has a seat.

## Consequences

- A training shop's paperwork lives in the same place as the morning's other blockers. The roster
  says who owes which form, and the prep link takes the student straight to it.
- Editing a form's text sends every student on a session not yet started back to sign, and the
  editor says how many before the save. There is no "non-material edit" choice yet; the release has
  one (issue #790) and forms could take the same one later.
- Form records carry the release's integrity seal (issue #2266): `integrity_hash` and
  `integrity_version` over the signed evidence, version 2 after erasure, re-sealed only over a
  record whose seal verified the moment before (`src/lib/course-form-integrity.ts`). `person_id`
  is inside it, so a diver merge moves the records through `refileCourseFormRecords`, which
  re-seals only a record that verified before the move. Records signed before the seal shipped
  read `unsealed`; there is no backfill.
  The shop export checks every seal as it writes `course_form_records.csv` (`integrity_check`).
- The prep page's sign step offers the forms door whenever the enrollment owes a form, whatever
  the switch says, so warn-only still has a way in besides the direct link the send delivers.
- Training dives that ride a regular charter, and handing one device round a family to sign, are
  not modelled here; both are filed as a follow-up.
