# Email runbook

How DiveDay sends mail to divers, how it learns what happened to it, and how DiveDay's own
addresses (`aaron@`, `legal@`) work. Decision and rationale:
[20260726-hosted-mailboxes-for-platform-mail](../architecture/decisions/20260726-hosted-mailboxes-for-platform-mail.md).

Two separate systems, deliberately:

| | Mail DiveDay sends to divers | Mail people send to DiveDay |
| --- | --- | --- |
| Handled by | Resend, from the app | A hosted mail provider |
| Lives in | `notification_deliveries` | The recipient's own mailbox |
| Domain | `send.dive.day` | `dive.day` |
| In this repo | Yes — `src/lib/notifications/` | **No.** DNS and a provider account |

Everything on the sending side degrades to "not configured" rather than half-working. With none of
it set the app runs, sends nothing, and records `not_configured` where a send would have gone.

### Rate limits, retries, and fan-out

The application reserves a durable team-wide request permit at 8 requests per second, below
Resend's configured 10 requests per second limit. It honors Resend's `Retry-After` and rate-reset
headers, retries 429/network/5xx responses with bounded backoff, and stores exhausted retryable
failures in `notification_send_queue`. The daily `/api/cron/reminders` pass drains that queue before
running reminders, recaps, and checkout recovery. A permanent 4xx is not retried.

Known fan-outs use Resend's batch endpoint, in groups of at most 100 messages. Each returned provider
message id is mapped back to the individual notification, so delivery webhooks and staff issues keep
their existing per-booking meaning. A batch request's idempotency key is deterministic for the whole
batch; individual sends retain their existing logical-send keys.

Reserved test recipients are rejected before a request is made. Resend blocks domains such as
`example.com` and returns a permanent `422`; DiveDay records the issue without spending a request
permit or placing it in the retry queue. For provider testing, use Resend's addresses such as
`delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`, or `suppressed@resend.dev`.
The demo seed intentionally uses reserved `.example` addresses, so it is not a real-inbox test
fixture; use one of Resend's test addresses or a real diver address when testing delivery.

| Variable | Enables | Without it |
| --- | --- | --- |
| `RESEND_API_KEY` | Sending | Nothing sends |
| `RESEND_FROM_EMAIL` | The sender on every outbound email | Nothing sends |
| `RESEND_WEBHOOK_SECRET` | `/api/webhooks/resend` | The endpoint answers 503; a bounce stays invisible |

## Sending to divers

1. **Verify `send.dive.day`** at [resend.com/domains](https://resend.com/domains) and add the DNS
   records it gives you. A subdomain, not the org domain: automated mail and human correspondence
   should not share a sending reputation, and this keeps a bulk-mail problem from affecting the
   address people actually write to you at.
2. **Create an API key** (`resend.com/api-keys`) with sending permission.
3. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. A friendly name is supported:
   `RESEND_FROM_EMAIL="Blue Mantis <bookings@send.dive.day>"`.
4. **Test it against a real inbox.** The honest test is a booking, not a curl: book a seat with your
   own Gmail address as the diver's email and confirm the confirmation arrives. Then check the
   delivery event landed — a message can sit in Gmail's spam folder and still report `delivered`,
   so read the Gmail side too.

## The delivery webhook

`POST {APP_HOST}/api/webhooks/resend` records what the provider says happened to mail already sent.

1. Add it at [resend.com/webhooks](https://resend.com/webhooks).
2. Subscribe to `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`,
   `email.complained`, `email.failed`, `email.suppressed`. Subscribing to more is harmless —
   anything the app doesn't act on is verified and answered 200. `email.opened` / `email.clicked`
   are deliberately never recorded: they're the privacy-invasive half of email analytics and answer
   no question a dive shop has.
3. Copy the signing secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET`.

Outcomes land on the notification's existing row, matched by Resend's message id, and a bounce,
complaint, or failure raises it on the shop's dashboard as an email issue — visible even though the
original send succeeded. A re-send clears the old outcome. Events about mail we never tracked are
answered 200 and ignored.

Verification fails closed: no signature, a wrong signature, or a timestamp more than 5 minutes old
is rejected before the database is touched. A 503 means the secret isn't set.

**Local development** needs a public URL. Tunnel with `ngrok http 3000` and register the tunnel as a
*second* webhook endpoint with its own secret — don't point production's endpoint at your laptop.

## DiveDay's own addresses

Not built into the app, on purpose — `aaron@dive.day` is a hosted mailbox and `legal@dive.day`
forwards to the lawyer. Attachments, threading, search, replying, and mobile all come from the mail
provider rather than from us.

**MX records name one mail host.** `dive.day`'s MX must point at the mail provider. Do not also
configure Resend inbound receiving on the same domain — they are mutually exclusive, and the app no
longer handles `email.received` in any case.

Setup, once:

1. Point `dive.day`'s MX at the provider and add the DKIM records it gives you.
2. Create `aaron@dive.day` as a real mailbox (a licensed user).
3. Create `legal@dive.day` as a **group with the lawyer's address as an external member**, not a raw
   forwarding rule — a group survives adding a second reader and handles forwarded-mail
   authentication better.
4. Send a test message with an attachment to each and confirm it arrives intact.

Mail forwarded to an external address fails SPF alignment at the far end, because the forwarding hop
rewrites the envelope sender. ARC signing mitigates it. If the lawyer's provider is strict about
DMARC you may see the occasional rejection; that's the standing cost of forwarding off-domain, not a
misconfiguration to chase.

## SPF, DKIM, DMARC

Two independent senders now sign for `dive.day`: the mail provider for human mail, Resend for
automated mail on `send.dive.day`. Both must be aligned before the policy is tightened, or you'll
start rejecting your own booking confirmations.

1. Enable DKIM in **both** the mail provider and Resend. This is the one that actually matters —
   DKIM survives forwarding, SPF often doesn't.
2. SPF on `dive.day` covers the mail provider; `send.dive.day` gets its own from Resend. Watch the
   10-lookup limit if you add more senders later.
3. Publish DMARC at `_dmarc.dive.day` starting permissive, with a reporting address:
   `v=DMARC1; p=none; rua=mailto:dmarc@dive.day`
4. **Read the reports for a couple of weeks.** Move to `p=quarantine` only once both senders show
   aligned in them, then to `p=reject`. Jumping straight to `reject` is how you discover a
   misaligned sender by having your mail disappear.

## When mail doesn't arrive

| Symptom | Look at |
| --- | --- |
| Endpoint returns 503 | `RESEND_WEBHOOK_SECRET` unset |
| Endpoint returns 400 | Wrong secret for this endpoint, or a replayed/stale request |
| Nothing sends, no error | `RESEND_API_KEY`/`RESEND_FROM_EMAIL` unset — check the shop dashboard for `not_configured` rows |
| Sends report `delivered`, diver says nothing arrived | Their spam folder; then DKIM/SPF/DMARC on `send.dive.day` |
| Mail to `aaron@`/`legal@` never arrives | MX records on `dive.day`; then the provider's own logs. Nothing about this path runs in DiveDay |
| The lawyer stops receiving forwarded mail | DMARC alignment on the forwarded hop — see above; check the group's config before assuming a DNS problem |
