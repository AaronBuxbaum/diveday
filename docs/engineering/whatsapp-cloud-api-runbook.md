# WhatsApp Cloud API runbook

How a dive shop connects its own WhatsApp Business number to DiveDay, what DiveDay needs from Meta
before any of it works, and what to check when messages stop arriving. The decision and its
trade-offs are in ADR
[20260802-whatsapp-embedded-signup](../architecture/decisions/20260802-whatsapp-embedded-signup.md).

## What this channel is

The **courtesy message** that rides alongside a trip reminder or a post-trip recap, and the *only*
channel for a diver who gave a phone number but no email. Email carries the full detail and the
links; this is the short nudge.

With a shop's WhatsApp connected, it comes from the shop's own verified business number. Without it,
the same message goes out as SMS through AWS SNS. Never both — see
`src/lib/notifications/courtesy.ts`.

## Current status: not yet switchable on

Connecting runs through **Meta Embedded Signup**, which requires Meta to approve DiveDay's own app
first. Until that clears, the settings page says "coming soon" and no shop can connect. This is the
expected state, not a misconfiguration.

## Platform setup (DiveDay, once)

### 1. Meta app and approval

Create a Meta app with the WhatsApp product, then complete:

- **Business verification** for the DiveDay business portfolio.
- **App review** for `whatsapp_business_management` and `whatsapp_business_messaging`.
- A **Tech Provider** Embedded Signup configuration, which is what produces the configuration id.

This is the long pole and is entirely external work.

### 2. Environment

| Variable | What |
| --- | --- |
| `META_APP_ID` | DiveDay's Meta app id. Also used by the browser to launch the popup. |
| `META_APP_SECRET` | Signs the token exchange **and** verifies every inbound webhook. |
| `META_WHATSAPP_SIGNUP_CONFIG_ID` | The Embedded Signup configuration id from the dashboard. |
| `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Any string; also entered in Meta's webhook config. Guards only the one-time subscription handshake. |
| `SECRET_ENCRYPTION_KEY` | 32 base64 bytes (`openssl rand -base64 32`). Seals each shop's access token at rest. |

With `META_*` unset the page shows "coming soon". With `SECRET_ENCRYPTION_KEY` unset there is
nowhere safe to put a token, so connecting is refused for that reason too.

### 3. Webhook

Point the app's WhatsApp webhook at `https://<app-host>/api/webhooks/whatsapp`, subscribe to the
`messages` field, and use the same verify token as above. Meta calls `GET` once with a challenge to
confirm the endpoint, then `POST`s delivery statuses.

Every shop's WhatsApp Business Account is subscribed to *DiveDay's* app during signup, which is what
lets this one endpoint verify every shop's events with one secret.

## What a shop does

Settings → WhatsApp (owner or manager only), press **Connect WhatsApp**, and complete Meta's own
popup: sign in with the Facebook account that manages the shop, pick or add the phone number divers
should hear from, accept Meta's terms.

Nothing is pasted and nothing is created in Meta's tools by hand. After the popup closes DiveDay
registers the number, subscribes to its delivery events, and **submits the message template for
approval on the shop's behalf**.

Then send a test message. Saving a connection proves nothing about whether the token has the right
scope or the template cleared review — the page shows *Not tested yet* until a real message lands.

## When messages stop arriving

Failures degrade to SMS rather than dropping, so the first symptom is usually "divers stopped seeing
our WhatsApp messages", not an error. Check the logs for `notification.whatsapp_send_failed` and
`notification.whatsapp_fell_back_to_sms`, both of which carry Meta's error code. Delivery outcomes
also land on the notification row itself via the webhook, so the staff notification view is the other
place to look.

| Meta code | Means | Fix |
| --- | --- | --- |
| `190` | Access token expired or revoked | The shop reconnects; the business token from Embedded Signup normally does not expire, so this usually means access was revoked in Business Manager. |
| `131026` | Recipient is not on WhatsApp | Nothing to fix — that diver gets SMS. Normal and expected. |
| `132001` | Template name/language not found | Template review failed or the template was deleted. Reconnecting re-submits it. |
| `132000` | Parameter count mismatch | The template no longer has exactly two body variables. |
| `130429` / `131048` | Rate or quality throttling | Meta is limiting the number; check its quality rating in WhatsApp Manager. |
| `133016` | Number locked or restricted | Business verification or a quality problem; resolve in Business Manager. |

Signup failures name the step that failed (`signup_failed_exchange`, `_register`, `_subscribe`,
`_template`) and log as `notification.whatsapp_signup_failed`:

- **exchange** — the one-time code was already used or expired. Press Connect again.
- **register** — the number is probably still active in the consumer WhatsApp or WhatsApp Business
  *app*; it has to be removed there first.
- **subscribe** / **template** — connected but incomplete. Pressing Connect again re-runs the whole
  flow, which is safe: an already-registered number and an existing template are both treated as a
  reconnect rather than an error.

## Rotating `SECRET_ENCRYPTION_KEY`

Rotating the key **without re-sealing existing rows silently degrades every connected shop to SMS**.
That is deliberate — a key change must not take the reminder cron down — but it means rotation is not
a one-liner. Either have every connected shop reconnect, or write a one-off migration that opens each
`shop_whatsapp_accounts.access_token_sealed` (and `registration_pin_sealed`) with the old key and
re-seals with the new one before swapping the environment value.

There is no in-app rotation flow yet; add one here if this stops being rare.

## Deliberately not built

**Inbound messages.** A diver replying reaches the shop's own WhatsApp inbox, where a human reads it.
DiveDay does not receive, store, or answer inbound WhatsApp — the webhook parses delivery statuses
and ignores everything else.

**Read receipts.** DiveDay does not record opens on any channel, so `read` statuses are dropped.

**SMS delivery statuses.** SNS does not send delivery webhooks for direct-to-phone-number publishes;
receipts go to CloudWatch Logs. Bringing SMS to parity needs an AWS-side pipeline (a Logs
subscription filter, or a move to AWS End User Messaging, which publishes events to SNS or Kinesis) —
its own piece of work, not a sibling of this route.
