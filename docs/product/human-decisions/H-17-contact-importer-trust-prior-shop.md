# H-17: Should the contact importer trust a prior shop's own waiver acceptance — including its…

- **Status:** Implemented
- **Human owner:** Product owner (sanity-checked by the generalist attorney — Tier 1, see [legal-engagement-scope.md](../stakeholders/legal-engagement-scope.md))

## Decision or approval needed

Should the contact importer trust a prior shop's own waiver acceptance — including its medical clearance — well ahead of the still-open H-01–H-03 legal sign-off on DiveDay's own waiver policy, and without requiring a per-row staff attestation the way the existing paper-signature path does? The assistant building this flagged the conflict with the contact importer's documented fail-closed medical rule ([20260723-contact-importer](../../architecture/decisions/20260723-contact-importer.md)) and recommended a staff-attested, medical-still-fail-closed alternative before implementing.

## Minimum outcome to record

**Decided 2026-07-24: yes, trust it — including medical clearance — marked distinctly as "imported," with no per-row staff attestation required.** The product owner considered and explicitly declined both of the assistant's safer alternatives (staff attestation; medical-only fail-closed). This decides only what a *contact import* does; it does not resolve H-01–H-03, which still gate DiveDay's own waiver policy before any shop's use of either path is production-ready.

## Unblocks / follow-up

Implemented: `signatureMethod: "imported"` waiver records, exempted from the template-version currency check but not the one-year age check. See [20260724-import-waiver-acceptance](../../architecture/decisions/20260724-import-waiver-acceptance.md).

Part of the [human decision log](README.md#decision-register).
