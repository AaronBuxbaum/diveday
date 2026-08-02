# 20260802-remove-sms-whatsapp-channel — Drop the Twilio SMS/WhatsApp channel entirely

- **Status:** Accepted
- **Supersedes:** 20260721-sms-whatsapp-notifications
- **Date:** 2026-08-02

## Context

[20260721-sms-whatsapp-notifications](20260721-sms-whatsapp-notifications.md) added a Twilio-backed
texting seam (`src/lib/notifications/sms.ts`, `notifySms()`/`smsProviderFromEnvironment()`) as a
courtesy-SMS-alongside-email and phone-only-tracked-channel path in `src/db/reminders.ts` and
`src/db/recap.ts`. It was never actually turned on: no Twilio account was ever provisioned, `TWILIO_*`
had its own temporary bypass in `scripts/check-env.mjs` pending real configuration that never
happened, and WhatsApp specifically was never wired to any UI copy at all (no `whatsapp` i18n key
exists in either locale) — it existed only as an unused code path (`SmsChannel = "sms" | "whatsapp"`).
The product owner has decided to drop the channel rather than keep carrying it: nobody has asked for
WhatsApp, and the branching it requires in both send paths (a `smsWork`/`emailWork` split, a
phone-only tracked-channel case, ~13+ test call sites threading a `smsProvider` option through
otherwise email-only test scenarios) was real, ongoing carrying cost for a feature with zero live
usage.

## Decision

Remove the texting channel completely, not just disable it:

- Delete `src/lib/notifications/sms.ts` and `sms.test.ts` outright — the whole seam
  (`SmsChannel`/`SmsMessage`/`SmsDelivery`/`SmsProvider`, `smsRecipient()`, `twilioSmsProvider()`,
  `disabledSmsProvider`, `notifySms()`, `smsProviderFromEnvironment()`).
- Remove the SMS branch from `sendDueReminders()` (`src/db/reminders.ts`) and `sendDueRecaps()`
  (`src/db/recap.ts`): the `smsProvider` option, the `smsWork`/`emailWork` split, the phone-only
  tracked-channel path, and `reminderSmsBody()`. Both flows go back to being email-only, exactly as
  they were before 20260721.
- Remove `TWILIO_*` from `.env.example` and delete the now-pointless bypass in
  `scripts/check-env.mjs` (there's no longer a `TWILIO_` prefix in `.env.example` for it to skip).
- Remove the `notifications.sms` copy block from both `src/i18n/locales/en-US/diver.json` and
  `es-ES/diver.json`.
- Update every living doc that describes the channel as shipped (`docs/product/rollout.md`,
  `shipped.md`, `glossary.md`, `human-decisions.md`, `assessments/competitive-analysis.md`,
  `stakeholders/README.md`, `stakeholders/privacy-and-communications.md`,
  `stakeholders/legal-engagement-scope.md`, and the ADRs that describe locale resolution or reminder
  cadence as covering "email and SMS") to describe email-only delivery. Historical/dated archive
  snapshots under `docs/product/archive/` are left untouched — they document what existed on that
  date, not the current state.
- `docs/architecture/decisions/20260721-sms-whatsapp-notifications.md` itself is not deleted or
  rewritten (an accepted ADR's content is never silently edited) — only its status line changes to
  "Superseded by 20260802-remove-sms-whatsapp-channel".

## Alternatives considered

- **Keep the seam but leave it permanently unconfigured** — rejected: unconfigured-but-present code
  still has to be read, maintained, and reasoned about on every touch of the two send paths it
  branches; the whole point of removing it is to stop paying that cost for a channel with zero users.
- **Keep SMS, drop only WhatsApp** — rejected: SMS itself was equally unconfigured and unused: this
  isn't "WhatsApp specifically turned out to be the wrong bet," it's "the entire texting channel
  never had a live user," so there's no principled reason to keep one half.
- **Delete the old ADR instead of superseding it** — rejected: ADRs are an append-only decision
  record; deleting one erases the reasoning a future reader might need if texting is reconsidered
  later, where a "superseded" pointer preserves the history and the current answer both.

## Consequences

`src/db/reminders.ts` and `src/db/recap.ts` return to email-only control flow, removing real
branching complexity and the associated test surface. No user-facing behavior changes for any real
diver, since the channel was never live. Losing: nothing currently working. Revisit if a genuine SMS
or WhatsApp need is identified later — that's a fresh build, not a revert, since
`notification_deliveries` never grew SMS-specific schema to restore and the removed code is gone, not
disabled.
