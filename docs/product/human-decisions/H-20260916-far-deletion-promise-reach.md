# H-20260916-far-deletion-promise-reach: How far does a deletion promise reach?

- **Status:** Chosen
- **Human owner:** Product owner + scuba-liability specialist

## Decision or approval needed

**How far does a deletion promise reach?** Three separate reaches, filed as #1726, #1721 and #1673. `booking_capabilities` is the one bearer-token table with no retention window and accumulates one permanent row per tap. The processor-erasure ledger has three targets and all three are Stripe, while every notification row keeps a `provider_message_id` — SES's or Twilio's handle on a message carrying the diver's name, address or phone — which `anonymizeDiver` never clears. And a guardian who co-signed a minor's release cannot have their own email erased: it is inside the v1 integrity field set, so nulling it makes `verifyWaiverIntegrity` report tampering on a release nobody touched.

## Minimum outcome to record

A ruling on each of the three, and the reasoning written into ADR 20260803-processor-erasure-obligations either way.

## Unblocks / follow-up

**Decided 2026-09-16 (Aaron Buxbaum, ready-for-human decision deck): the promise reaches outward.** #1726 adds `booking_capabilities` to `RetainedTable` and `RETENTION_DAYS` with a delete arm keyed on `expires_at`, in the shape the three other token tables already use; a capability still usable is never pruned out from under the diver holding it. #1721 extends the obligation ledger to messaging-provider handles — a provider handle is a pointer to an object holding the diver's data, and an argument that stops at Stripe is about which vendor has a delete API rather than about what was promised. #1673 builds a v3 waiver seal excluding third-party contact details, so erasure can null `guardian_email` and re-seal the way `anonymizeDiver` already re-seals as v2 over the survivors; the guardian's name stays, because it is part of who signed. **No attorney has read this**; H-20260730-jurisdiction-waiver-text-medical and H-20260724-current-typed-name-explicit stay Ready.

**Narrowed 2026-10-17 (Aaron Buxbaum, on #1721):** none of the messaging providers has a delete for a sent message, so #1721 ships as follows. SES and SNS message ids raise no row: those logs sit in DiveDay's own AWS account, and DiveDay's own log retention discharges them. WhatsApp owes no row either, because Meta keeps Cloud API messages at most 30 days with no business-accessible view or delete ([Meta: data privacy and security](https://developers.facebook.com/documentation/business-messaging/whatsapp/data-privacy-and-security)); erasure redacts DiveDay's inbox and scrambles the `wamid` ids, which embed the number, and DiveDay's own retention covers the rest, the same reasoning as SES and SNS. `integration_sync_records.external_id` stays out of the ledger. The reasoning is in ADR 20260803-processor-erasure-obligations, "Widened 2026-10-17".

Part of the [human decision log](README.md#decision-register).
