# H-103: Can a guardian have their own email erased without erasing the child?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Can a guardian have their own email erased without erasing the child?** A parent who co-signs a minor's release has no record of their own, and their address sat inside the release's v1 seal, so the only erasure on offer was the child's (`anonymizeDiver`) and a nulled address would have read as tampering (issue #1673, the third reach of H-82).

## Minimum outcome to record

Whether the address goes on its own, and what the release says afterwards.

## Outcome

**Decided 2026-10-07 (Aaron Buxbaum, in the project thread): erase just the guardian's email, and keep a note on the sealed release that it was redacted.** An owner erases it from the child's record, typing the address back; it goes from every live release in that shop carrying it and from any unsent guardian draft. A release whose seal verified is re-sealed as **v4**: everything v3 seals except `guardian_email`, plus who erased it and when (`guardian_email_erased_at`, `guardian_email_erased_by_person_id`), so the note is inside the seal; the release's staff page reads "Sealed. The guardian's email was erased …". The guardian's name, relationship and signature times stay, because they are who signed. A check constraint keeps an erased address from being written back. H-82 named this seal v3; v3 had since gone to refiled releases (ADR 20260907-guardian-co-signature, amended). **No attorney has read this**; H-01 and H-03 stay Ready.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
