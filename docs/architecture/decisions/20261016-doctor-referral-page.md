# 20261016-doctor-referral-page — The doctor's page: the official form by link, the answers behind a date of birth

- **Status:** Accepted (amended 2026-10-16 after the layer r5-3 security and dive-domain reviews)
- **Date:** 2026-10-16

## Context

A diver the questionnaire refers to a physician is held off the boat until staff record the
answer, and used to go to the doctor empty-handed. Fifth-loop item 17 asked for a "Take this to
your doctor" page; the owner chose its contents in
[H-20261014-physician-form-for-referral](../../product/human-decisions/H-20261014-physician-form-for-referral.md). It is opened by the
waiver link, which anyone it is forwarded to can open, so what it shows is the security question.

## Decision

`/waivers/[token]/doctor` opens only while the release waits on a physician (`awaitsPhysician` in
`src/lib/waivers.ts`, built on `isUnresolvedMedicalHold`), the diver is on file, and the seat is
held on a scheduled departure that ended less than a day ago (`DOCTOR_PAGE_TRIP_GRACE_MS`).
Otherwise it redirects to the waiver page, never `notFound()`; the waiver page offers the door on
the same gate (`doctorPageOpen`). It carries:

- the diver's **name** and the official form to print: the UHMS/DMSC *Diver Medical | Participant
  Questionnaire*, 10346 EN, version 2026-01-01, page 3, named and linked
  (`RSTC_QUESTIONNAIRE.published`), never a restyled copy;
- the **referral answers behind the diver's date of birth**: `revealDoctorAnswersAction` compares
  the entered date with the one on file (rate-limited per IP and per diver, failing closed; at 20
  wrong dates per release, `waiver_records.doctor_unlock_failures`, the answers stay locked for the
  rest of the hold) and returns each
  referral item's place and **published prompt**, never free-text detail, with the form version
  answered. With no date on file or nothing to show, the page says to go through the whole
  questionnaire;
- the shop's contacts and "Send a photo of the signed form to <email> before your dive day, or
  bring it to the shop before you dive".

It prints with a zero `@page` margin (`capabilityPagePrintRule`), so the browser prints no URL.

## Alternatives considered

- **Question numbers and a printed date of birth** (as first accepted): withdrawn. The form is
  public, so a number is the condition to any reader, a doctor cannot evaluate against a number,
  and the date of birth was a new identifier on a forwardable link.
- **The blank form only**: the doctor would not know what to ask about.
- **A separate doctor token**: a second capability to issue and revoke.
- **A restyled examiner's page** (first shipped): unchecked against the PDF, so it must not stand
  in for the legal form.

## Consequences

A forwarded link shows the diver's name and that an evaluation is pending, until a day after the
departure. The conditions need the date of birth too, which the page never prints; the rate limit
and the ceiling stop guessing, not someone who knows the birthday. The answers gate is a **review-driven
amendment** to H-20261014-physician-form-for-referral, noted there for the owner to revisit. Revisit if a jurisdiction needs another
examiner form, or once page 3 is checked and pinned by sha256 like the questionnaire.
