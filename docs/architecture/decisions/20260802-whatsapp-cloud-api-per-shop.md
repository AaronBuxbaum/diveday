# 20260802-whatsapp-cloud-api-per-shop — Add WhatsApp via Meta's Cloud API, with each shop's own account

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

The courtesy text that rides alongside a trip reminder or recap currently goes out as SMS through
AWS SNS ([20260802-sns-sms-adapter](20260802-sns-sms-adapter.md)). That record removed WhatsApp from
the notification seam entirely and said why: SNS has no WhatsApp delivery path, no WhatsApp UI or
copy had ever been wired up, and carrying a channel no provider could serve was dead weight. It
closed by naming the condition for reversing that — "add a WhatsApp adapter alongside this one,
behind the same interface, if that's ever explicitly requested."

It has now been explicitly requested, with two constraints from the product owner: use **Meta's own
API** rather than a reseller, and let **each shop plug in its own WhatsApp account** rather than
routing every shop's messages through one DiveDay number. Twilio is ruled out by name.

Both constraints point the same way, and they matter for the product rather than just the plumbing.
Most of DiveDay's target market outside the US runs its customer conversations on WhatsApp already —
a Cozumel or Bali shop's divers will read a WhatsApp message and ignore an SMS from an unknown short
code. Sending from the shop's own verified business number is what makes the night-before reminder
recognisable instead of suspicious, and it means a diver who replies reaches the shop, not a void.

That per-shop requirement is what makes this structurally different from every other notification
provider DiveDay has integrated. Resend, SES, and SNS are all *platform* credentials: one API key in
the environment, one sender for everyone. Here DiveDay is not the sender at all — the dive shop is —
so credentials become per-tenant rows, and a live sending credential has to be stored on a shop's
behalf.

Two facts about the WhatsApp Cloud API constrain the design further:

1. **Business-initiated messages must use a pre-approved template.** Free-form text is only allowed
   inside a 24-hour window that the *customer* opens by messaging the business first. A trip
   reminder is business-initiated by definition, so every message DiveDay sends here is a template
   send, and the template belongs to the shop's own WhatsApp Business account and its review queue.
2. **Template parameters are more restricted than an SMS body.** Meta rejects any parameter
   containing a newline, a tab, or more than four consecutive spaces, and caps each at 1024
   characters.

## Decision

- **Meta WhatsApp Cloud API, called with plain `fetch`.** `src/lib/notifications/whatsapp.ts` posts
  to `https://graph.facebook.com/<version>/<phone-number-id>/messages` with a bearer token. This is
  an ordinary authenticated REST call, so it stays on the fetch-based house style — the AWS clients'
  SDK exception was earned by SigV4 signing complexity, which has no analogue here. The Graph API
  version is a pinned constant, not a floating alias, so a version bump is a reviewable diff.

- **Per-shop credentials in a new `shop_whatsapp_accounts` table**, one row per shop, holding the
  phone number id, the approved template name and language, and the access token. There is
  deliberately **no** `whatsAppProviderFromEnvironment` counterpart to `smsProviderFromEnvironment`:
  a provider is built from a row, and there are as many live senders as connected shops.

- **The access token is encrypted at rest** with AES-256-GCM via a new `src/lib/secret-box.ts`,
  keyed by `SECRET_ENCRYPTION_KEY` (32 base64 bytes). This is the first genuine secret DiveDay holds
  on a shop's behalf and the reason that key now exists. A Stripe *account id* is a public
  identifier, useless without DiveDay's own platform key; a Meta access token **is** the capability,
  and a database dump containing one in plaintext is a compromise of that shop's WhatsApp presence.
  GCM rather than plain CBC/CTR because it authenticates as well as encrypts: a tampered ciphertext
  fails to open instead of decrypting into garbage that then gets sent to Meta as a bearer token.
  Nothing outside `src/db/whatsapp-accounts.ts` can read a token back — the module's only export
  path is a ready-made provider that has already closed over it, so no route, action, or log line
  can surface one.

- **One template, two variables, named by the shop.** DiveDay documents a canonical body
  (`Hi! An update from {{1}}: {{2}}`) taking the shop name and the message text, so a shop gets
  *one* template approved rather than one per notification kind — the difference between switching
  this on in an afternoon and abandoning it mid-review. The name and language are stored per shop
  rather than hard-coded, because a shop whose approval went through under a different name must
  still work. The existing composed courtesy-message text becomes the second parameter, sanitised
  through `templateParameter` to satisfy Meta's whitespace and length rules.

- **WhatsApp is preferred over SMS, never sent in addition.** `src/lib/notifications/courtesy.ts`
  owns the rule so `reminders.ts` and `recap.ts` don't each grow a copy: a shop with a connected
  sender gets WhatsApp, everyone else gets SMS. Sending both would double-message the diver and pay
  twice for it.

- **Any non-`sent` WhatsApp outcome falls back to SMS immediately**, including retryable ones. The
  dominant real-world failure is the diver simply not being on WhatsApp (Meta error 131026), and a
  trip reminder that arrives after the boat leaves is worth nothing — a second channel now beats a
  retry later. The exception is a shop with WhatsApp connected and no SMS credentials at all, where
  the WhatsApp failure is reported rather than SMS's `not_configured`, which would otherwise claim
  nothing was set up about a channel the shop did set up.

- **Connecting is owner/manager work** (`canManageMessagingSettings`), re-checked against live roles
  on every mutation — the same accountability weight as payment settings, since the credential sends
  as the business.

- **A test send is part of the connect flow.** Saving credentials proves nothing: not that the token
  has the right scope, not that the template cleared review, not that the language code matches the
  approval. `verifiedAt` records that a real message actually landed, and the settings page shows
  "not tested yet" until it has.

- **Disconnecting deletes the row**, unlike `shop_stripe_accounts.disconnected_at`, which
  tombstones. The difference is what the row holds: once a shop says disconnect, the safest thing to
  retain is nothing.

## Alternatives considered

- **Twilio's WhatsApp API.** Ruled out by the product owner explicitly, and consistent with
  [20260802-sns-sms-adapter](20260802-sns-sms-adapter.md)'s reasoning for dropping Twilio from the
  SMS channel: no second vendor account for a channel that can be reached directly. Going through
  Meta also keeps the shop's WhatsApp Business account in the shop's own hands rather than nested
  under a reseller's.

- **One DiveDay-owned WhatsApp number for every shop.** Far simpler — one credential, no encryption
  key, no settings page. Rejected because it defeats the purpose: divers would get trip reminders
  from "DiveDay" rather than the shop they booked with, replies would land nowhere useful, and
  WhatsApp's own quality ratings would pool every shop's behaviour into one number, where a single
  shop's blast could throttle everyone.

- **Meta Embedded Signup** (the Facebook-Login-for-Business flow that provisions a shop's WABA
  in-app). This is the better long-term onboarding story and would also make delivery webhooks work
  uniformly (see below). Rejected *for now* because it requires DiveDay to complete Meta app review
  and business verification before any shop can use it — a multi-week external dependency that would
  block the feature entirely. The paste-your-own-credentials flow shipped here works today, and
  Embedded Signup can replace the connect form later without touching the adapter, the table, or the
  send path.

- **Per-recipient template language.** Rejected: a template exists only in the languages the *shop*
  got approved, and DiveDay cannot know which those are. Sending a diver's own locale to a shop that
  only approved English fails the send outright. The shop's one stored language is used for every
  recipient; the per-person locale that governs email
  ([20260731-per-person-notification-locale](20260731-per-person-notification-locale.md)) still
  governs the message *body*, which is what carries the actual words.

- **A per-notification-kind template set** (`diveday_reminder_7d`, `diveday_recap`, …). Rejected as
  a setup-cost multiplier: each one is a separate Meta review a shop has to shepherd, and the
  reminder text is already composed as one string.

- **A delivery-status webhook, matching the Resend/SES pattern.** Deferred, not forgotten. Meta signs
  webhooks with the App Secret of the **Meta app the number is subscribed to** — under
  paste-your-own-credentials that is the *shop's* app, not DiveDay's, so no single platform secret
  can verify them and a real implementation needs a per-shop app secret (sealed alongside the token)
  plus routing an inbound event to the right shop by the WABA id in its payload before picking a key.
  That is a coherent design and is written down here so it doesn't have to be rediscovered, but it is
  a second integration's worth of surface for status detail on a best-effort courtesy channel — and
  the SMS channel beside it ships with no delivery webhook either. The send call still yields `sent`
  plus a `wamid`, which is what gets recorded. Embedded Signup would make this uniform and is the
  natural time to revisit.

## Consequences

- **`SECRET_ENCRYPTION_KEY` is new required-ish configuration.** Absent, the WhatsApp settings page
  says so and refuses to store anything; everything else in DiveDay runs unchanged. Set it with
  `openssl rand -base64 32`. Rotating it without re-sealing existing rows silently degrades every
  connected shop to SMS rather than erroring — deliberate (a reminder cron must not die over a key
  change), but it means rotation needs a re-seal step, documented in the runbook.
- **`SmsDelivery` is now an alias of the shared `CourtesyDelivery`**, so both text adapters report the
  same shape and either can be recorded through `recordNotificationDelivery` unchanged.
- **A phone-only diver's tracked delivery may now carry a `wamid`** rather than an SNS message id.
  Nothing reads provider ids as SNS-shaped, so this is additive.
- **Shops serving two languages get one template language.** Their divers still get the body in
  their own locale; the template wrapper is fixed. If this bites, the fix is a stored set of approved
  languages rather than a single value.
- **Setup is genuinely more work for a shop than pasting a Stripe key** — a Meta Business account, a
  system user, a token, and a template review. That cost is inherent to WhatsApp, not to this design,
  and it is why the settings page walks through it and offers a test send at the end.
