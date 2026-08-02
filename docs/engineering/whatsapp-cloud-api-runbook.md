# WhatsApp Cloud API runbook

How a dive shop connects its own WhatsApp Business number to DiveDay, and what to check when
messages stop arriving. The decision and its trade-offs are in ADR
[20260802-whatsapp-cloud-api-per-shop](../architecture/decisions/20260802-whatsapp-cloud-api-per-shop.md).

## What this channel is

The **courtesy text** that rides alongside a trip reminder or a post-trip recap. Email carries the
full detail and the links; this is the short nudge. It is also the *only* channel for a diver who
gave a phone number but no email.

With a shop's WhatsApp connected, that message comes from the shop's own verified business number.
Without it, the same message goes out as SMS through AWS SNS. Never both — see
`src/lib/notifications/courtesy.ts`.

## One-time platform setup

`SECRET_ENCRYPTION_KEY` must be set for any shop to connect. It seals every shop's access token at
rest (`src/lib/secret-box.ts`).

```sh
openssl rand -base64 32
```

Set it in the deployment environment. Until it is set, the WhatsApp settings page says credential
storage is unavailable and refuses to save anything. Nothing else in DiveDay depends on it.

## What a shop needs before connecting

This part happens in Meta's tools, not DiveDay's, and it is the slow half — the template review in
step 4 is the one to start early.

1. **A WhatsApp Business account with a phone number.** In Meta Business Manager, add the shop's
   number to a WhatsApp Business account. The number must not be active on the consumer WhatsApp or
   WhatsApp Business *app* — Meta will refuse to register it.
2. **The phone number ID.** In WhatsApp Manager → API Setup, copy the **phone number ID**. This is a
   long numeric id, not the phone number itself; pasting the phone number is the most common setup
   mistake, and DiveDay rejects it at the form.
3. **A permanent access token.** Create a **system user** in Business Settings with a role that can
   send messages, assign it the WhatsApp Business account, and generate a token with
   `whatsapp_business_messaging`. Prefer a permanent system-user token over a temporary developer
   token, which expires in 24 hours and will strand the channel silently the next day.
4. **An approved message template.** Create one template with **exactly two body variables**:

   ```
   Hi! An update from {{1}}: {{2}}
   ```

   `{{1}}` is the shop name and `{{2}}` is the message text. Name it `diveday_courtesy_update` (the
   default DiveDay prefills) or anything else — the name is stored per shop. Submit it for review and
   wait for **Approved**. Category is *Utility*.

   One template covers every notification kind on purpose. Do not create separate reminder/recap
   templates; there is nothing to point them at.

## Connecting in DiveDay

Settings → WhatsApp (owner or manager only). Paste the phone number ID, the access token, and the
template name and language, then **send a test message to your own number**.

The test send is not decoration. Saving credentials proves nothing about whether the token has the
right scope, whether the template cleared review, or whether the language code matches the approval —
a test message is the only thing that does. The page shows *Not tested yet* until one lands.

## When messages stop arriving

Failures degrade to SMS rather than dropping, so the first symptom is usually "divers stopped seeing
our WhatsApp messages", not an error. Check the logs for `notification.whatsapp_send_failed` and
`notification.whatsapp_fell_back_to_sms`, both of which carry Meta's error code.

| Meta code | Means | Fix |
| --- | --- | --- |
| `190` | Access token expired or revoked | Generate a new system-user token and re-connect. A temporary token was probably used. |
| `131026` | Recipient is not on WhatsApp | Nothing to fix — that diver gets SMS. Normal and expected. |
| `132001` | Template name/language not found | The template is not approved, was renamed, or was approved in a different language than the one stored. |
| `132000` | Parameter count mismatch | The template no longer has exactly two body variables. |
| `130429` / `131048` | Rate or quality throttling | Meta is limiting the number. Check the number's quality rating in WhatsApp Manager. |
| `133016` | Number locked or restricted | Business verification or a quality problem; resolve in Business Manager. |

A `not tested yet` badge on a shop that used to work means someone re-connected and never re-tested;
credentials are re-proved on every connect.

## Rotating `SECRET_ENCRYPTION_KEY`

Rotating the key **without re-sealing existing rows silently degrades every connected shop to SMS**.
That is deliberate — a key change must not take the reminder cron down — but it means rotation is not
a one-liner. Either:

- have every connected shop re-connect (paste their token again), which re-seals under the new key; or
- write a one-off migration that opens each `shop_whatsapp_accounts.access_token_sealed` with the old
  key and re-seals with the new one, before swapping the environment value.

There is no in-app rotation flow yet; add one here if this stops being rare.

## Deliberately not built

**A delivery-status webhook.** Meta signs webhooks with the App Secret of the Meta app the number is
subscribed to — under paste-your-own-credentials that is the shop's app, not DiveDay's, so no single
platform secret can verify them. The ADR records the per-shop-app-secret design this would need. The
send call still returns a `wamid`, which is what gets recorded on the delivery row. The SMS channel
beside it has no delivery webhook either.

**Inbound messages.** A diver replying to a WhatsApp message reaches the shop's own WhatsApp inbox,
where a human reads it. DiveDay does not receive, store, or answer inbound WhatsApp.
