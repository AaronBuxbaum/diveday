# H-20261013-under-18-on-party: Does the public party form ask "Under 18"?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Does the public booking form ask, per diver, whether they are under 18?** [H-20260730-minimum-age-gate-data](H-20260730-minimum-age-gate-data.md) put a guardian co-signature on a minor's release ([20260907-guardian-co-signature](../../architecture/decisions/20260907-guardian-co-signature.md)), but the rule reads a date of birth and the public form asks nobody one, so a parent who booked "Maya, 12" and forwarded her link watched her sign her release alone. The third UX review (2026-10-13, section 5, decision 2) recommended one per-diver checkbox on the party form.

## Minimum outcome to record

Yes or no, and what the box writes.

## Outcome

**Decided 2026-10-13 (Product owner: Aaron Buxbaum, in the project thread, "Build all", taking the review's recommendation):** yes, the checkbox.

- Each member of the public party form has an **Under 18** box (`BookingPartyFields`). A tick stamps that member's seat, `bookings.minor_declared_at`, and nothing on the person: the form is anonymous, so it may only mark the seat it creates, and it gates nothing at the sale (no age oracle, [H-20260724-minimum-age-gate-fail](H-20260724-minimum-age-gate-fail.md)).
- `guardianSignatureRequired` reads it beside the date of birth: **a date on file decides**, and with none the tick asks for the co-signature. The waiver page, `completeWaiver`, the paper release at the counter, the issue path, course forms, the roster's **Minor** badge and readiness's `guardian_signature_missing` all read the same rule. A staffer corrects a wrong tick by entering the date of birth.
- Person-scoped readers with no seat in hand (the diver record's waiver standing and paper release, a counter rental) read the stamp off any of the person's seats still ahead: not cancelled, on a live, scheduled departure not yet over. The diver record then asks for a date of birth, and nothing writes one from the stamp (Aaron, 2026-10-24, issue #2553, Option A). A canceled day's carried preparation reads the stamp on that day's own seat too, called off or not.
- Exported with the seat (`minor_declared_at`), cleared on erasure.

## Unblocks / follow-up

None. Asking a date of birth at the sale stays out of scope (H-20260724-certification-levels-agency-rules, H-20260724-minimum-age-gate-fail).

Part of the [human decision log](README.md#decision-register).
