# H-73: Can a parent whose name matches their child's ever co-sign a minor's release?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Can a parent whose name matches their child's ever co-sign a minor's release?** `personNamesMatch` refuses a co-signer with the diver's own name on both the online and the paper path, with no override, so a family who genuinely share every name token had no route to a recorded release anywhere in the product and readiness raised **guardian signature missing** forever. Raised by a `dive-domain-expert` review on #1539 and filed as #1573: the reviewer's point was that the two paths hold different evidence — online the shop has no evidence a second person exists; on paper a named staffer watched two people sign — so the identical refusal may not be right on both.

## Minimum outcome to record

Which of the two: leave the rule on both paths and record the reasoning, or let the paper path record it on the staffer's attestation. Either way it belongs in the ADR and the glossary.

## Unblocks / follow-up

**Decided 2026-09-10 (Aaron Buxbaum, ready-for-human decision deck, issue #1573): let the paper path record it on the staffer's attestation, never the online path.** Shipped the same day ([20260907-guardian-co-signature](../../architecture/decisions/20260907-guardian-co-signature.md), decision 10): the paper form grows one checkbox saying the staffer watched both of them sign, the co-signature is stored as `in_person_attested_namesake`, and the refusal stays the default everywhere else. **No attorney has read this relaxation**; H-01 and H-03 stay Ready.

Part of the [human decision log](README.md#decision-register).
