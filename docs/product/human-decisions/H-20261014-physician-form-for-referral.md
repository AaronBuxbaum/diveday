# H-20261014-physician-form-for-referral: What does a referred diver's "Take this to your doctor" page carry?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**What does a referred diver's "Take this to your doctor" page carry?** A diver referred by the medical questionnaire is sent to a physician with nothing to hand over. Raised by the fifth-loop ideas, decision 1.

## Minimum outcome to record

The choice, and where it is said.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the project thread, "Do recommended decisions for each", taking the recommendation):** The page carries the physician form with name, date of birth and the numbers of the questions answered yes, never the answers' detail.

**Amended 2026-10-16 after review (review-driven, for the product owner to revisit):** the page no longer prints the date of birth, and the answers sit behind it. The layer r5-3 security review found that a question number on the public form tells any reader of a forwarded link which condition it is (F1), and the dive-domain review found that a doctor cannot evaluate against a bare number (FIX 1). So the page shows the diver's name and the official form to print; once the diver re-enters their date of birth, it shows each referral answer's published prompt (never free-text detail) and the form version answered. With no date of birth on file it says to go through the whole questionnaire. The examiner's page is the official PDF's page 3, linked rather than restyled. The page closes a day after the departure ends. If the owner prefers the original outcome, that is a change to [the ADR](../../architecture/decisions/20261016-doctor-referral-page.md).

## Unblocks / follow-up

Implemented by layer r5-3: `/waivers/[token]/doctor`, opened from the held waiver page's "Take this to your doctor" ([ADR 20261016-doctor-referral-page](../../architecture/decisions/20261016-doctor-referral-page.md)).

Part of the [human decision log](README.md#decision-register).
