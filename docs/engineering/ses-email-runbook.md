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

### The custom MAIL FROM domain

The `From:` address a diver sees and the envelope sender a receiving mail server checks are two
different addresses. SES defaults the envelope to a shared `amazonses.com` subdomain; the stack
overrides it to `mail.ses.dive.day` (`mailFromDomain` on the `EmailIdentity`, overridable with
`--context sesMailFromDomain=...`).

**`ses.dive.day` cannot be its own MAIL FROM domain.** It is the identity, and the envelope domain
must be a separate subdomain that you don't send from and don't receive mail on. That rules out both
the identity and `dive.day` itself.

**It must be a child of the identity, not a sibling.** AWS's docs contradict each other here, so
don't resolve this by reading:

| Source | Constraint | Correct? |
| --- | --- | --- |
| [Developer guide](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html) | subdomain of the identity's **parent domain** | **No** |
| [`SetIdentityMailFromDomain`](https://docs.aws.amazon.com/ses/latest/APIReference/API_SetIdentityMailFromDomain.html) | subdomain of the **verified identity** | Yes |

Settled by experiment: `mail.dive.day` was deployed against identity `ses.dive.day` and SES answered
`400 InvalidRequest` —

```
Provided MAIL-FROM domain <mail.dive.day> is not subdomain of the domain of the identity <ses.dive.day>
```

so the guide's "parent domain" wording is wrong and `mail.dive.day`, `bounce.dive.day`, and
`send.dive.day` are all invalid while the identity is `ses.dive.day`. The name has to nest:
`mail.ses.dive.day`. The stack derives it as `mail.${sesEmailDomain}` for that reason.

**This one fails loudly** — CloudFormation rejects the stack update, so a malformed name can't reach
production. That is a different failure from `BehaviorOnMxFailure` below, which is soft and covers
only whether the MX *record* resolves, never the shape of the name.

Two records, on `mail.ses.dive.day`, both in the `SesMailFromRecords` stack output:

| Type | Value |
| --- | --- |
| MX | `10 feedback-smtp.<region>.amazonses.com` — region must match `SES_AWS_REGION` |
| TXT | `v=spf1 include:amazonses.com ~all` |

**Exactly one MX record.** SES fails the whole MAIL FROM setup if that subdomain has more than one.

These are added by hand: authoritative DNS for `dive.day` is **Vercel DNS**, not Route53, so the CDK
stack has no hosted zone to write them into. It configures the AWS side and prints what to add.

Failure is soft by design — `mailFromBehaviorOnMxFailure` is `USE_DEFAULT_VALUE`, so a missing or
still-propagating MX record falls back to the `amazonses.com` envelope rather than rejecting the
send. Mail keeps flowing while DNS catches up; you lose SPF alignment, not the booking confirmation.
SES reports the setup as `Pending` for up to 72 hours before giving up and marking it `Failed`, at
which point the setup has to be restarted.

**Soft failure means nothing tells you it broke**, so check rather than assume — mail sending
normally is not evidence the envelope domain took:

```bash
aws sesv2 get-email-identity --email-identity ses.dive.day \
  --query 'MailFromAttributes' --output json
```

`MailFromDomainStatus` should read `SUCCESS`. `PENDING` past a few hours after the DNS records
resolve, or `FAILED`, is a DNS problem — check that exactly one MX record exists on the subdomain and
that its region matches `SES_AWS_REGION`. It is *not* the subdomain-shape rule above; that one is
rejected at deploy and never reaches this state.

## The delivery webhook

`POST {APP_HOST}/api/webhooks/ses` records what SES says happened to mail already sent, delivered as
an SNS notification.

Every `pnpm infra:deploy` subscribes this route to the topic
([20260803-webhook-subscriptions-in-cdk](../architecture/decisions/20260803-webhook-subscriptions-in-cdk.md)) —
no flag, nothing to remember. One thing is still yours:

**Set `SES_SNS_TOPIC_ARN`** to the `SesEventNotificationsTopicArn` output's value and redeploy the
app. Verified messages whose own `TopicArn` doesn't match are rejected even when correctly signed,
so a differently-sourced SNS message can't be replayed here.

Until that is set the route answers 503, which means it cannot confirm SNS's handshake — so on a
fresh environment the subscription the stack just created will expire in ~3 days. Check it landed:

```bash
aws sns list-subscriptions-by-topic --topic-arn <SesEventNotificationsTopicArn>
```

`PendingConfirmation` means the endpoint answered non-2xx; see
[§9 of the infrastructure runbook](infrastructure-runbook.md#9-webhook-subscriptions) for the
unsubscribe-and-redeploy recovery. Otherwise the route auto-confirms the handshake itself once it
verifies SNS's signature, and there is nothing else to do.

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

**SPF is checked against the envelope sender, not the From address.** This is the part that is easy
to get backwards: publishing SPF on `ses.dive.day` does nothing, because `ses.dive.day` is the domain
in the `From:` header and no receiver looks there for SPF. SPF belongs on the MAIL FROM domain —
`mail.ses.dive.day` — which is why that subdomain exists and why it must not be the same one you
send from.

1. Enable DKIM in **both** the mail provider and SES (Easy DKIM, SES's default). This is the one that
   actually matters — DKIM survives forwarding, SPF often doesn't.
2. SPF on `dive.day` covers the mail provider. SES's SPF goes on `mail.ses.dive.day`, alongside
   that subdomain's single MX record — see [the custom MAIL FROM domain](#the-custom-mail-from-domain)
   above. Watch the 10-lookup limit if you add more senders later.
3. Publish DMARC at `_dmarc.dive.day` starting permissive, with a reporting address:
   `v=DMARC1; p=none; rua=mailto:dmarc@dive.day`
4. **Read the reports for a couple of weeks.** Move to `p=quarantine` only once both senders show
   aligned in them, then to `p=reject`. Jumping straight to `reject` is how you discover a
   misaligned sender by having your mail disappear.

Both alignment paths are relaxed by default, so `mail.ses.dive.day` (envelope) and `ses.dive.day`
(From) both roll up to the `dive.day` organizational domain and count as aligned. Only a
`v=DMARC1; ...; aspf=s` strict policy would require them to match exactly — don't set that.

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
