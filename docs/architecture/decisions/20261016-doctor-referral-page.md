# 20261016-doctor-referral-page — Print question numbers, never answers, on the doctor's page

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

When the questionnaire refers a diver to a physician, the release parks in `medical_review` and
readiness keeps them off the boat until staff record the physician's answer. The diver used to go
to the doctor empty-handed. The fifth-loop ideas (item 17) asked for a printable "Take this to your
doctor" page, and the product owner chose what it carries in
[H-127](../../product/human-decisions/H-127-physician-form-for-referral.md). This is the first
diver-facing page to print medical information from a bearer link. That link is the waiver link,
forwardable by anyone who holds it, so what goes on the page is the security question.

## Decision

`/waivers/[token]/doctor` renders only when the record behind the link still waits on a physician:
`medical_review`, neither answer recorded, not superseded, not erased (`awaitsPhysician` in
`src/lib/medical.ts`), and the diver still on file. Any other state redirects to the waiver page,
which already words each state; the page never calls `notFound()`. The page carries:

- the examiner's evaluation form (`PHYSICIAN_EVALUATION_FORM`), English like the questionnaire
  (H-01/H-03), with the diver's **name** and **date of birth** printed in, or a blank line when no
  date is on file;
- the **numbers** of the answers that call for evaluation ("Question 3", "Box B, question 2"), and
  never their prompts or any answer's detail. A primary yes that only opened a Box is left out,
  because the Box item it led to implies it. An unfinished form names nothing and says so;
- the shop's name, phone and email, and "Bring the signed page to the dock, or send a photo to
  <shop email>".

`getDoctorReferral` (`src/db/waivers-medical.ts`) turns the stored answers into numbers itself,
so the answers never reach the page module. Staff record the outcome exactly as before.

## Alternatives considered

- **Print the flagged prompts** — rejected by H-127. A forwarded link would disclose the condition.
- **Print nothing medical, only the blank form** — the doctor would then have no idea which
  answers to ask about.
- **A separate, shorter-lived doctor token** — a second capability to issue and revoke, for data
  the waiver link can already open.

## Consequences

Anyone holding a held diver's waiver link can see their name, their date of birth and which
question numbers they answered yes, for as long as the hold stands. Recording either answer, a
fresh link or erasure closes the page. A question number reveals which questions to look up, not
the answer behind it. The form's wording is transcribed and must track the published UHMS/DMSC
form; when the questionnaire version moves, check this form in the same change. Revisit if a shop
needs the official PDF itself attached, or if a jurisdiction requires a different examiner form.
