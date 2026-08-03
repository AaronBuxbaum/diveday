# Email runbook

How DiveDay sends mail to divers, how it learns what happened to it, and how DiveDay's own
addresses (`aaron@`, `legal@`) work. Decision and rationale:
[20260726-hosted-mailboxes-for-platform-mail](../architecture/decisions/20260726-hosted-mailboxes-for-platform-mail.md)
and [20260803-ses-sole-email-provider](../architecture/decisions/20260803-ses-sole-email-provider.md).

AWS SES is the only email provider (Resend has been removed entirely). The AWS-side production
access request, DKIM DNS verification, credential minting, and SNS webhook subscription are manual
steps not yet done — see [§7 of the infrastructure runbook](infrastructure-runbook.md#7-ses-email-provider-infra)
for that checklist. Until they're done, every send resolves to `not_configured` rather than failing.

Two separate systems, deliberately:

| | Mail DiveDay sends to divers | Mail people send to DiveDay |
| --- | --- | --- |
| Handled by | AWS SES, from the app | A hosted mail provider |
| Lives in | `notification_deliveries` | The recipient's own mailbox |
| Domain | `ses.dive.day` | `dive.day` |
| In this repo | Yes — `src/lib/notifications/` | **No.** DNS and a provider account |

Everything on the sending side degrades to "not configured" rather than half-working. With none of
it set the app runs, sends nothing, and records `not_configured` where a send would have gone.

### Retries and idempotency

The AWS SDK (`@aws-sdk/client-sesv2`) handles its own retry/backoff for SES throttling and 5xx
responses, so the application needs no hand-rolled request loop. Exhausted retryable failures land in
`notification_send_queue`; the daily `/api/cron/reminders` pass drains that queue before running
reminders, recaps, and checkout recovery. A permanent 4xx is not retried.

SES has no request-level idempotency token — a client-side timeout racing a server-side success can
double-send in a way a provider with one wouldn't. The queue-level dedup on
`notification_send_queue.idempotency_key` is the real safety net; this is a narrower, accepted gap
(see the ADR's Consequences).

Reserved test recipients (`example.com`, `demo.com`, and similar) are rejected before a request is
made — DiveDay records the issue without spending a send. The demo seed intentionally uses reserved
`.example` addresses, so it is not a real-inbox test fixture; use an SES mailbox simulator address
(`success@simulator.amazonses.com`, `bounce@simulator.amazonses.com`,
`complaint@simulator.amazonses.com`) or a real diver address when testing delivery.

| Variable | Enables | Without it |
| --- | --- | --- |
| `SES_AWS_REGION` / `SES_AWS_ACCESS_KEY_ID` / `SES_AWS_SECRET_ACCESS_KEY` | Sending | Nothing sends |
| `SES_FROM_EMAIL` | The sender on every outbound email | Nothing sends |
| `SES_SNS_TOPIC_ARN` | `/api/webhooks/ses` | The endpoint answers 503; a bounce stays invisible |

## Sending to divers

1. **Verify `ses.dive.day`** — deploy the CDK stack (`infra/lib/infra-stack.ts`), then add the three
   `SesDkimRecords` CNAME records to DNS and wait for AWS to show the identity verified. A subdomain,
   not the org domain: automated mail and human correspondence should not share a sending
   reputation, and this keeps a bulk-mail problem from affecting the address people actually write to
   you at.
2. **Request SES production access** (an AWS Support case — CDK cannot do this). SES starts in
   sandbox mode, which can only send to pre-verified recipient addresses.
3. **Mint the sender credentials**: `aws iam create-access-key --user-name diveday-ses-sender` (also
   in the `SesSenderAccessKeyInstructions` output). Store the result only in the deploy environment's
   secrets — never the repo.
4. Set `SES_AWS_REGION`, `SES_AWS_ACCESS_KEY_ID`, `SES_AWS_SECRET_ACCESS_KEY`, and `SES_FROM_EMAIL`. A
   friendly name is supported: `SES_FROM_EMAIL="Blue Mantis <bookings@ses.dive.day>"`.
5. **Test it against a real inbox.** The honest test is a booking, not a curl: book a seat with your
   own Gmail address as the diver's email and confirm the confirmation arrives. Then check the
   delivery event landed — a message can sit in Gmail's spam folder and still report `delivered`,
   so read the Gmail side too.

## The delivery webhook

`POST {APP_HOST}/api/webhooks/ses` records what SES says happened to mail already sent, delivered as
an SNS notification.

1. Take the `SesEventNotificationsTopicArn` CDK output and create an HTTPS subscription pointing at
   the webhook URL, in the SNS console (or `aws sns subscribe`).
2. The route auto-confirms the subscription handshake itself once it verifies SNS's signature — no
   separate confirmation step.
3. Set `SES_SNS_TOPIC_ARN` to the same topic ARN. Verified messages whose own `TopicArn` doesn't
   match are rejected even if correctly signed, so a differently-sourced SNS message can't be
   replayed here.

The configuration set already publishes `BOUNCE`, `COMPLAINT`, `DELIVERY`, `DELIVERY_DELAY`,
`REJECT`, and `RENDERING_FAILURE` events. `OPEN`/`CLICK` engagement tracking is deliberately never
enabled (`vdmOptions.engagementMetrics` left off in `infra-stack.ts`) — they're the privacy-invasive
half of email analytics and answer no question a dive shop has.

Outcomes land on the notification's existing row, matched by SES's own message id, and a bounce,
complaint, or failure raises it on the shop's dashboard as an email issue — visible even though the
original send succeeded. A re-send clears the old outcome. Events about mail we never tracked are
answered 200 and ignored.

Verification fails closed: SNS message signature verification happens by hand
(`src/lib/notifications/sns.ts`) against `SigningCertURL`, which is validated against
`^https://sns\.[a-zA-Z0-9-]+\.amazonaws\.com(\.cn)?/` before ever being fetched. A missing or invalid
signature, or a `TopicArn` mismatch, is rejected before the database is touched. A 503 means
`SES_SNS_TOPIC_ARN` isn't set.

**Local development** needs a public URL to receive SNS notifications. Tunnel with `ngrok http 3000`
and create a *second* SNS subscription pointing at the tunnel — don't point production's subscription
at your laptop.

## DiveDay's own addresses

Not built into the app, on purpose — `aaron@dive.day` is a hosted mailbox and `legal@dive.day`
forwards to the lawyer. Attachments, threading, search, replying, and mobile all come from the mail
provider rather than from us.

**MX records name one mail host.** `dive.day`'s MX must point at the mail provider. Do not also
configure inbound receiving on `ses.dive.day` — mail delivery and the transactional-sending identity
are separate concerns, and the app doesn't handle inbound mail events in any case.

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

Two independent senders now sign for `dive.day`: the mail provider for human mail, SES for automated
mail on `ses.dive.day`. Both must be aligned before the policy is tightened, or you'll start
rejecting your own booking confirmations.

1. Enable DKIM in **both** the mail provider and SES (Easy DKIM, SES's default). This is the one that
   actually matters — DKIM survives forwarding, SPF often doesn't.
2. SPF on `dive.day` covers the mail provider; `ses.dive.day` gets its own via `include:amazonses.com`.
   Watch the 10-lookup limit if you add more senders later.
3. Publish DMARC at `_dmarc.dive.day` starting permissive, with a reporting address:
   `v=DMARC1; p=none; rua=mailto:dmarc@dive.day`
4. **Read the reports for a couple of weeks.** Move to `p=quarantine` only once both senders show
   aligned in them, then to `p=reject`. Jumping straight to `reject` is how you discover a
   misaligned sender by having your mail disappear.

## When mail doesn't arrive

| Symptom | Look at |
| --- | --- |
| Endpoint returns 503 | `SES_SNS_TOPIC_ARN` unset |
| Endpoint returns 400 | An unverified SNS signature, a `TopicArn` mismatch, or a malformed message |
| Nothing sends, no error | `SES_AWS_*`/`SES_FROM_EMAIL` unset or invalid — check the shop dashboard for `not_configured` rows |
| Sends fail with a rejection | Still in SES sandbox mode (recipient not pre-verified) — request production access |
| Sends report `delivered`, diver says nothing arrived | Their spam folder; then DKIM/SPF/DMARC on `ses.dive.day` |
| Mail to `aaron@`/`legal@` never arrives | MX records on `dive.day`; then the provider's own logs. Nothing about this path runs in DiveDay |
| The lawyer stops receiving forwarded mail | DMARC alignment on the forwarded hop — see above; check the group's config before assuming a DNS problem |
