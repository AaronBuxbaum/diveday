# 20260805-rstc-medical-questionnaire - Model the 2026 RSTC participant questionnaire and conditional clearance

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The previous implementation used an eight-question paraphrase and treated every yes as a
physician referral. The 2026 UHMS/DMSC form uses ten top-level questions plus conditional Boxes,
so that rule incorrectly blocks cases such as question 1 yes followed by all Box A no answers.
The product decision also permits storing the participant's yes/no answers server-side. The
published participant form remains safety/legal copy pending the H-01/H-03 specialist sign-off
recorded in `docs/product/human-decisions.md`.

## Decision

DiveDay uses version 2 of the 2026-01-01 UHMS/DMSC Diver Medical Participant Questionnaire as the RSTC questionnaire source of truth:

<https://uhms.org/images/Recreational-Diving-Medical-Screening-System/forms/Diver_Medical_Participant_Questionnaire_10346_EN_English_2026-01-01.pdf>

The ten top-level questions are not all physician referrals:

- Questions 3, 5, and 10 are direct referrals when answered **Yes**.
- Questions 1, 2, 4, 6, 7, 8, and 9 open Box A, B, C, D, E, F, and G respectively. A **Yes** to the applicable Box question is a referral; a **Yes** to the parent question with every applicable Box answer **No** is not a referral.
- The page-two dental/oral-recovery question is always applicable and is a referral when answered **Yes**.
- An incomplete, unknown, or malformed v2 answer set fails closed and cannot complete a waiver.

The result is an operational status, not medical advice: `completed` means the questionnaire did not identify a required physician evaluation; `medical_review` means the diver must obtain physician evaluation before boarding. DiveDay never grants physician clearance.

## Storage and access control

Responses are stored server-side in the existing `waiver_records.medical_answers` JSONB value, alongside the questionnaire id and version. A draft is held in `draft_medical_answers` so “save for later” does not lose the diver’s work. This is intentional product policy: storing the participant’s yes/no answers is permitted for this workflow.

The existing controls remain mandatory:

- A diver can write only through their own single-use, hashed bearer waiver capability. The token is rate-limited and every write is scoped to its waiver record and booking.
- Staff reads are shop-scoped and role-gated. The roster and incident export expose only the derived review status; the signed-record disclosure shows flagged prompts only to authorized waiver reviewers.
- Medical answers are excluded from incident exports and contact imports. Diver erasure removes the answers and re-seals the remaining waiver evidence.
- Signed records retain the questionnaire version so a later form revision never reinterprets old evidence. Version 1 remains readable only for legacy records; all new links use version 2.

No database migration is required for this change: the current schema already provides versioned JSONB answer storage, draft persistence, integrity sealing, and erasure. The migration ledger therefore remains unchanged.

## Alternatives considered

- **Keep the eight-question paraphrase and refer every yes** — rejected because it contradicts the
  published 2026 form and blocks divers the form clears.
- **Store only the derived status** — rejected because staff need the captured evidence for the
  signed-record review and the product decision explicitly permits server-side answers.
- **Trust hidden browser fields for closed Boxes** — rejected; applicability is derived again on
  the server from the parent answers.

## Consequences

The waiver page renders only applicable Boxes, and the server independently derives applicability from the parent answers rather than trusting hidden browser fields. Unit and database tests cover direct referrals, conditional clearance (question 1 plus all-`No` Box A), incomplete input, legacy v1 compatibility, and malformed/unknown answers.
