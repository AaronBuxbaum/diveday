# H-83: May a dive chain share one WhatsApp Business account across shops?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**May a dive chain share one WhatsApp Business account across shops?** Uniqueness sits on `waba_id` alone, so a chain set up the ordinary way — one Meta Business account, a number per location — gets its second shop refused permanently, and the refusal points at disconnecting the first. Filed as #1767, with two defects beside it: #1766, where any shop owner can POST the signup action with a WABA id and ten junk characters and read off the `?notice=` whether another DiveDay shop holds that account (no Meta credential needed, because Meta is never contacted, and the action is not rate limited); and #1769, a check-then-act race that can leave a phone number registered at Meta bound to a PIN nobody holds.

## Minimum outcome to record

Which routing key, plus a ruling on whether the two defects wait for it.

## Unblocks / follow-up

**Decided 2026-09-16 (Aaron Buxbaum, ready-for-human decision deck): chains may share; route on `phone_number_id`.** `value.metadata.phone_number_id` is parsed in both the inbound-message and delivery-event parsers, the unique index moves off `waba_id` onto `phone_number_id` with a migration, and the WABA reader stays only as the fallback for an event naming no number. **#1766 and #1769 do not wait for this and are not conditional on it.** #1766 splits the code exchange out of `completeEmbeddedSignup` so the pre-check runs below it: the refusal still precedes any number registration, so the PIN-lockout property is preserved, and the oracle now costs a valid Meta authorization code. The refusal is not made vague — that would send a chain owner hunting a fault on DiveDay's side over a disclosure about their own Meta asset. #1769 takes an advisory lock on the WABA id spanning the pre-check and the insert; recovery for a number bound to a lost PIN runs through Meta support, not through DiveDay.

Part of the [human decision log](README.md#decision-register).
