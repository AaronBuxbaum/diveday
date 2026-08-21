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
- The dental/oral-recovery question is Box C's fifth item, reached only through a **Yes** to question 4, and is a referral like every other Box question.
- An incomplete, unknown, or malformed answer set fails closed and cannot complete a waiver.

The result is an operational status, not medical advice: `completed` means the questionnaire did not identify a required physician evaluation; `medical_review` means the diver must obtain physician evaluation before boarding. DiveDay never grants physician clearance.

## Storage and access control

Responses are stored server-side in the existing `waiver_records.medical_answers` JSONB value, alongside the questionnaire id and version. A draft is held in `draft_medical_answers` so “save for later” does not lose the diver’s work. This is intentional product policy: storing the participant’s yes/no answers is permitted for this workflow.

The existing controls remain mandatory:

- A diver can write only through their own single-use, hashed bearer waiver capability. The token is rate-limited and every write is scoped to its waiver record and booking.
- Staff reads are shop-scoped and role-gated. The roster and incident export expose only the derived review status; the signed-record disclosure shows flagged prompts only to authorized waiver reviewers.
- Medical answers are excluded from incident exports and contact imports. Diver erasure removes the answers and re-seals the remaining waiver evidence.
- Signed records retain the questionnaire version so a later form revision never reinterprets old evidence. Version 2 remains readable only so an already-signed record can be interpreted — it is refused for a *new* signature (`validateMedicalAnswers`'s `requireCurrent`, which `completeWaiver` passes), because a corrected form must never be answered under the version it corrected. Version 1 was deleted outright: it was a paraphrase DiveDay wrote that no published form ever carried, so no record could need it to be read honestly. All new links use version 3 (see the 2026-08-20 amendment).

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

## Amendment 2026-08-20 — the dental question was in the wrong place, and nobody could have checked

**What was wrong.** v2 modelled "still healing/recovering from a recent dental/oral procedure" as a
standalone question in its own `dental` section, asked of every diver and always a referral. On the
published form that sentence is the **fifth item of BOX C**, reached only by answering **Yes** to
question 4 ("problems with my eyes, ears, or nasal passages/sinuses or teeth"). The transcription
error is understandable — the item *is* physically on page two, which is where Boxes A-G live, and
"page two, therefore not one of the ten, therefore standalone" is one bad inference away from
correct.

**Fixed as version 3, not as an edit to version 2.** `dental_recovery` is gone; `box_c_5` carries
the form's own wording, appended after `box_c_4` because `box_c_1`..`box_c_4` are the *stored answer
keys* and inserting anywhere else would silently re-point them at different questions. v2 is
retained in `BY_KEY` exactly as v1 is, and `medical.test.ts` pins the reason: a v2 record answering
`q4: false, dental_recovery: true` is a diver a physician was asked to see, and re-reading it under
v3's applicability rule returns `clear` — a boarding hold lifting itself with no migration, no
staff notification and no failing test. This is the first time the version pin above has had to do
its job, and it is why editing v2 in place was not an option, H-49 notwithstanding: H-49 governs
dead code and dead tables, not stored evidence a shop is legally holding.

**The diver-facing effect, stated plainly.** DiveDay used to refer a small number of divers the
form itself clears — the over-ask direction, and the safe one. It now matches the form. The
population that changes behaviour is small, because question 4 already says "or teeth", so a diver
with a healing extraction is likely to open Box C anyway and meet the item there. `waiver.dentalHeading`
("One last check, for everyone") is deleted from both locales: it named a section that no longer
exists, and "for everyone" had stopped being true.

**Provenance, which did not exist before and is the finding with the longest half-life.** Nothing in
this repository recorded which document `src/lib/medical.ts` was transcribed from, so the question
"does the real form nest this item?" could not be answered from inside the codebase — it took the
product owner producing the PDF. The module docstring now records the source: *Diver Medical |
Participant Questionnaire*, product 10346 EN, version date 2026-01-01, sha256
`a02cbc5e415a2882cfa2df47b081e2e123ef208c55c3e3bf1b9e26e6a417e960`, checked question by question on
2026-08-20. Boxes A, B, D, E, F and G matched what v2 already held; only the dental item did not.
Any future revision states its own hash the same way. H-01's specialist sign-off needs an artefact
to sign off *against*, and this is it.
