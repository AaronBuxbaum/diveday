# Resend email runbook

How DiveDay sends and receives email, and what to do to make either work in a new environment.
Decision and rationale: [20260724-resend-webhook-email-events](../architecture/decisions/20260724-resend-webhook-email-events.md).

Everything here degrades to "not configured" rather than half-working. With none of it set the app
runs, sends nothing, and records `not_configured` where a send would have gone.

## The pieces

| Variable | Enables | Without it |
| --- | --- | --- |
| `RESEND_API_KEY` | Sending, and fetching received message bodies | Nothing sends; inbound files metadata with an empty body |
| `RESEND_FROM_EMAIL` | The sender on every outbound email | Nothing sends |
| `RESEND_WEBHOOK_SECRET` | `/api/webhooks/resend` | The endpoint answers 503; no bounce or inbound ever arrives |
| `PLATFORM_ADMIN_EMAILS` | `/admin/**` for those addresses | Nobody can reach the console |

## Sending

1. **Verify a domain** at [resend.com/domains](https://resend.com/domains) and add the DNS records
   it gives you (SPF/DKIM, and DMARC if you don't have one). Verification is what stops Gmail
   filing you as spam — an unverified sender reaches an inbox roughly never.
2. **Create an API key** (`resend.com/api-keys`) with sending permission.
3. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. A friendly name is supported:
   `RESEND_FROM_EMAIL="Blue Mantis <bookings@example.com>"`.
4. **Test it against a real inbox.** The honest test is a booking, not a curl: book a seat on a
   trip with your own Gmail address as the diver's email, and confirm the confirmation arrives.
   Then check the delivery event landed (below) — a message can arrive in Gmail's spam folder and
   still report `delivered`, so read the Gmail side too.

## The webhook

One endpoint carries both delivery outcomes and inbound mail: `POST {APP_HOST}/api/webhooks/resend`.

1. Add it at [resend.com/webhooks](https://resend.com/webhooks).
2. Subscribe to the events you want. Delivery outcomes: `email.sent`, `email.delivered`,
   `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`,
   `email.suppressed`. Inbound: `email.received`. Subscribing to more is harmless — anything the
   app doesn't act on is verified and answered 200. `email.opened` / `email.clicked` are
   deliberately not recorded even if you subscribe.
3. Copy the signing secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET`.

**Local development** needs a public URL. Tunnel with `ngrok http 3000` (or VS Code port
forwarding) and register the tunnel URL as a *second* webhook endpoint with its own secret — don't
point production's endpoint at your laptop. The Resend CLI's `emails receiving listen` also works
for inbound.

Verification fails closed. A request with no signature, a wrong signature, or a timestamp more than
5 minutes old is rejected before the database is touched. If the endpoint answers 503, the secret
isn't set.

### What delivery events do

They land on the notification's existing row, matched by Resend's message id, and a bounce,
complaint, or failure raises it on the shop's dashboard as an email issue — visible even though the
original send succeeded. A re-send clears the old outcome. Events about mail we never tracked (a
message sent from the Resend dashboard, a wait-list invite) are answered 200 and ignored.

## Receiving

1. **Point a domain at Resend** under Emails → Receiving. Use a subdomain if the domain already has
   mail (`inbound.dive.day`), or a Resend-managed `*.resend.app` domain to try it out. Add the MX
   records it gives you.
2. Make sure the webhook above is subscribed to `email.received`.
3. **Add the addresses** in DiveDay at `/admin/mailboxes` — `hello@`, `legal@`, one row each — and
   add the people who should read each one. A reader must already have an active DiveDay login, and
   is matched by that login's email — not the address on their person record, which is editable
   roster data any shop can put anything into.
4. **Test it**: send a mail from your Gmail to one of those addresses and watch it appear at
   `/admin/inbox`.

Mail arrives for *every* address at the domain, so anything not claimed by a mailbox — a typo, a
retired alias — is filed as unrouted and shown only to operators. Nothing is dropped.

Only the plain-text part of a message is stored, deliberately: a received body is arbitrary content
from anyone on the internet and is never rendered as markup. Bodies are truncated at 20k
characters, and attachments are flagged but not stored — open those in Resend.

**Sending *from* these addresses isn't built yet.** Replies happen in your own mail client, and
aren't recorded in DiveDay.

## Access to the console

`PLATFORM_ADMIN_EMAILS` is a comma-separated allowlist of operator addresses:

```
PLATFORM_ADMIN_EMAILS=aaron@dive.day,ops@dive.day
```

Operators read every address including unrouted mail, and are the only people who can manage
addresses. Everyone else sees exactly the mailboxes they've been added to. A signed-in staff member
with neither gets a 404 — the console doesn't announce itself. Access is re-read from the database
on every request, so removing someone takes effect immediately.

An allowlisted address is matched against the **login** it was signed in with (`user_accounts`), and
must be an active account. Two consequences worth knowing: a person's roster email is irrelevant to
this, and self-signup at `/onboard` refuses an allowlisted address outright — otherwise an operator
address with no account yet (the normal state of a fresh deploy) would be one shop registration away
from being claimed. Put an address on the allowlist *before* its account exists and you'll need to
create that account another way.

## When mail doesn't arrive

| Symptom | Look at |
| --- | --- |
| Endpoint returns 503 | `RESEND_WEBHOOK_SECRET` unset |
| Endpoint returns 400 | Wrong secret for this endpoint, or a replayed/stale request |
| Nothing sends, no error | `RESEND_API_KEY`/`RESEND_FROM_EMAIL` unset — check the shop dashboard for `not_configured` rows |
| Sends report `delivered`, diver says nothing arrived | Their spam folder; then SPF/DKIM/DMARC on the sending domain |
| Inbound never appears | MX records; the `email.received` subscription; then whether any mailbox claims that address (unrouted mail is operator-only) |
| Inbound appears with an empty body | `RESEND_API_KEY` unset or unauthorized — the body is a second API call |
