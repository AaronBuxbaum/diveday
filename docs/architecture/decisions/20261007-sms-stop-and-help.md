# 20261007-sms-stop-and-help — Text from one toll-free number, and keep a STOP list of our own

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

SMS goes through AWS SNS from DiveDay's own account (ADR 20260802-sns-sms-adapter), and US carriers deliver it only from a registered origination identity. Registration is judged on three things a reviewer can see: a consent line where the number is collected, texts that say how to stop them, and STOP and HELP that work. DiveDay had none of the three: no phone field said texts would follow, no text named STOP, and SMS had no inbound path at all (ADR 20260907-two-way-inbox, decision 7). Aaron asked for the filing on 2026-10-07 and for STOP and HELP to work.

## Decision

- **One US toll-free number for the platform**, verified once, not 10DLC. Every shop's texts leave from it. Under 10DLC a platform sending for many businesses registers each one as its own brand; toll-free is one registration. The request and registration are manual action `sns-sms-account-limits`.
- **HELP and STOP are answered by AWS** from keyword replies set on the number (`put-keyword`), the same for every diver. The app sends no replies.
- **The number is two-way only for keywords.** It forwards every inbound text to the existing `diveday-sms-delivery-receipts` topic, through a role this stack creates (`diveday-sms-two-way`). `/api/webhooks/sms` already verifies that topic's envelopes; `parseSmsReply` (`src/lib/notifications/sms-replies.ts`) reads STOP and its carrier synonyms, and START, as the *whole* reply. Everything else, HELP included, is acknowledged and dropped. Conversation over SMS stays out of scope.
- **The app keeps its own STOP list**, `sms_opt_outs`, keyed by E.164 number and platform-wide because the number is. `stopListedSmsProvider` (`src/db/sms-opt-outs.ts`) wraps the SNS sender at every caller, so a listed number is refused before AWS is asked, as a non-retryable `failed` with code `opted_out`. START deletes the row; nothing else does: not retention, not erasure, not a shop reset.
- **Every SMS ends with the STOP line**, in the diver's language. `sendCourtesyMessage` takes it as a required `smsStopLine` and appends it to the SMS only; a WhatsApp send never carries it.
- **Every phone field a diver fills in for themselves says what giving it means**, through one component, `SmsConsentNote`: the booking form's lead phone, self-registration, and the seat claim. The privacy page says mobile numbers are used only for booking texts and never shared for anyone's marketing.

## Alternatives considered

- **10DLC** — per-shop brand registration and fees for every shop that signs up; wrong shape for one platform number.
- **Trust AWS's opt-out list alone** — AWS does honor STOP on the number, but the app could not tell a shop why a phone-only diver got no reminder, and nothing would hold if the sender changed.
- **A separate topic and webhook for replies** — a second env var and subscription for messages the existing route can tell apart by shape.
- **Per-shop opt-out** — wrong for one shared number: a STOP to one shop's reminder must stop the next shop's text from the same number.
- **The STOP line in the message bundle per text** — four bodies to keep in step; a required field on the one send path cannot be forgotten.

## Consequences

- Texts get one segment longer for some reminders. Accepted: an unlabelled sender is filtered.
- A diver who replied STOP gets no booking text from any shop until they reply START. Email is unaffected.
- The phone number, its keywords and its two-way setting are hand-set and per region; a region move repeats them (`docs/engineering/region-migration.md`).
- Revisit if a shop needs its own number, or if volume outgrows toll-free throughput; either moves to per-shop 10DLC registration behind the same `SmsProvider` seam, and the STOP list would then be keyed by sending number as well.
