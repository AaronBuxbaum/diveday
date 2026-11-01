# H-20261009-rider-snorkeler-medical: Which medical form do a snorkeler and a rider get?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Which medical form do a snorkeler and a rider get?** Since participant types landed (ADR [20261007-participant-types](../../architecture/decisions/20261007-participant-types.md)), every seat was sent the same dive medical and held at boarding by the same medical gate, so a parent riding along to watch was asked about lung collapse and ear surgery, and a "yes" put a physician referral in front of someone who would never get wet (issue #2212). H-20260730-jurisdiction-waiver-text-medical and H-20260724-current-typed-name-explicit cover the waiver and the medical for divers and said nothing about a non-diver. The options were (1) no medical for riders, the dive medical for snorkelers; (2) a short non-diver questionnaire for snorkelers and nothing for riders; (3) the dive medical for everyone, as shipped.

## Minimum outcome to record

Which participant types are asked for which medical, and which are held at boarding on it.

## Outcome

**Decided 2026-10-09 (Aaron Buxbaum, on issue #2212): option 1.** A rider gets no medical form at all and is never blocked on a medical; a snorkeler keeps the dive medical exactly as a diver does. Whether a rider signs the release at all stays with H-20260730-jurisdiction-waiver-text-medical, and a rider still signs it.

- **Implemented: the boarding gate.** `calculateReadiness` in `src/lib/readiness.ts` raises no `medical_review` or `medical_not_cleared` for a rider's seat (`isHeldToMedical`, `src/lib/participant-types.ts`), and a release a referral parked or a physician refused counts as the signed release it is. The rider's release is chosen by `effectiveReleaseForRiderSeat` (`src/lib/waivers.ts`): the newest signature that is current, against current terms, inside the year and not superseded, held or not. A snorkeler and a seat with no type are held exactly as before. A diver switched to riding past a referral boards as a rider, and the record still reads as held on the roster; switching back into the water holds the seat again.
- **Implemented: the crew still sees it** (dive-domain review of #2212). A rider boarding on a held release is never silent at the rail: `riderMedicalHold` (`src/lib/waivers.ts`), carried on the readiness row and the manifest, puts "Riding only: MD said no" or "Riding only: referred" on the live roll call's one capsule, its printed sheet and the offline copy (`medicalWarnings`, an additive field with no version bump), with the date. A physician's "no" on an earlier release outranks an open referral on this one. A warning, never a blocker.
- **Decided 2026-10-13 (Aaron Buxbaum, on issue #2382): a held snorkeler boards riding only.** A snorkeler whose questionnaire referred them to a physician, or whom a physician refused, stays blocked as a snorkeler. A staffer switches that seat to rider (Coming as, on the roster row) and the rider path above applies: they board with the "Riding only" warning and nobody is in the water on a medical hold. There is no surface-only clearance and no new gate. The snorkeler's medical blocker carries a line on the roster row pointing at the switch, and switching back into the water holds the seat again (`src/lib/readiness.test.ts`). A separate recorded surface-only clearance waits for a shop to ask.
- **Not yet built: the form.** The waiver link still asks a rider the dive medical. A release is signed once per person and carries across every booking (`effectiveWaiverForBooking`), so a release signed with no medical must never satisfy a later seat in the water; that needs the record to say it carries no medical, the signing page and the counter's paper path to skip it for a rider, and a diver seat to refuse a rider-only release. Reported for its own issue rather than guessed at here.

## Unblocks / follow-up

Issue #2212 (the gate); the rider-only release, as above. Option 2, a short non-diver questionnaire for snorkelers, waits for a shop to ask.

Part of the [human decision log](README.md#decision-register).
