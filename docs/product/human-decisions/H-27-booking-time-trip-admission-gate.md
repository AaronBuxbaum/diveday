# H-27: The booking-time trip admission gate (DOM-M6, ADR 20260803-trip-admission-at-booking) is inverted relative to risk: it…

- **Status:** Chosen
- **Human owner:** Product owner + operations lead

## Decision or approval needed

The booking-time trip admission gate (DOM-M6, ADR [20260803-trip-admission-at-booking](../../architecture/decisions/20260803-trip-admission-at-booking.md)) is **inverted relative to risk**: it refuses carded regulars — the divers least likely to book the wrong boat, because the shop knows exactly what they hold — and never refuses un-carded strangers, who are the ones who book the Spiegel Grove seat because it "reads like the good one". A `dive-domain-expert` review proposes **disclosure + attestation instead of refusal**: when a gated charter meets a diver the shop has no record of, the public booking form asks what they hold, and the answer is written as a `pending` certification so it lands in the staff verify queue rather than being discarded. The disclosure half (the trip's requirement stated above the form) shipped 2026-08-03 and needs no decision. The **attestation** half does: it would be the first diver-writable certification row in the product, which is exactly the thing `src/lib/trip-admission.ts`'s docstring warns turns the gate into self-attestation.

## Minimum outcome to record

Whether to collect a self-declared card at booking on a gated charter; if yes, how an attested row is distinguished from a staff transcription, and whether admission may read it.

## Unblocks / follow-up

**Decided 2026-08-20: collect it and believe it.** Before a trip an attested certification is taken at its word, whoever stated it; before the boat it must be sighted. The diver types their card number, it lands in the staff verify queue, and it is checked before the dive date. The self-attestation this row worried about is accepted with open eyes — see ADR [20260820-attested-at-booking-verified-at-boarding](../../architecture/decisions/20260820-attested-at-booking-verified-at-boarding.md). The gate half is **implemented**, and the booking form started asking for the agency and card number on **2026-08-21** (issue #630) — so the policy's three moving parts are all in place. The number lands in `certifications.declared_identifier`, deliberately not in `identifier`: a stranger writing into the column the unique index covers would fail the sale on a collision and disclose whether a number is on file (`security-reviewer`). H-24's leak is reopened deliberately: a bare tap now asserts something. Closes DOM-M6's remaining gap for un-carded divers. Interacts with H-24 and H-22 (the public form never refuses on a personal attribute).

Part of the [human decision log](README.md#decision-register).
