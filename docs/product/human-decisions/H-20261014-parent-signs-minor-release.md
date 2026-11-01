# H-20261014-parent-signs-minor-release: May a parent sign a child's release from the parent's own link?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**May a parent sign a child's release from the parent's own link?** A seat booked "Under 18" ([H-20261013-under-18-on-party](H-20261013-under-18-on-party.md)) often has no email of the child's own, so no online path reached the guardian card and the child's release was signed at the counter on dive morning. Raised by the fourth UX review (2026-10-14), section 5, decision 3.

## Minimum outcome to record

The choice, and where it is said.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the project thread, "Do recommended decisions for each", taking the recommendation):** Yes. A parent may sign a child's release from the parent's own `/ready` ("Sign Mia's waiver", with the guardian block, on the parent's device); the minor's claim page says a parent or guardian signs with them.

- Built by layer r4-1 (fourth review item 1), with a `security-reviewer` pass: [20261014-parent-signs-minor-release](../../architecture/decisions/20261014-parent-signs-minor-release.md). The lead's verified link is the authority, the seat must be an unclaimed declared minor in their own party still owing a release, and the waiver link is minted on the tap.

## Unblocks / follow-up

Typed consent as the assurance level stays [H-20260724-current-typed-name-explicit](H-20260724-current-typed-name-explicit.md)'s question.

Part of the [human decision log](README.md#decision-register).
