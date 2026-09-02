# Email runbook

How DiveDay sends mail to divers, how it learns what happened to it, and how DiveDay's own
addresses (`aaron@`, `legal@`) work. Decision and rationale:
[20260726-hosted-mailboxes-for-platform-mail](../architecture/decisions/20260726-hosted-mailboxes-for-platform-mail.md)
and [20260803-ses-sole-email-provider](../architecture/decisions/20260803-ses-sole-email-provider.md).

AWS SES is the only email provider (Resend has been removed entirely). Two AWS-side steps are still
outstanding and both are genuinely manual: the production-access request and the DKIM/MAIL FROM DNS
records. Credential minting is not among them any more — `cdk deploy` mints the sender key and
delivers it in the credentials secret ([§10](infrastructure-runbook.md#10-the-credentials-secret)) —
and the SNS webhook subscription stopped being manual in
[20260803-webhook-subscriptions-in-cdk](../architecture/decisions/20260803-webhook-subscriptions-in-cdk.md).
The checklist is [manual-actions.md](manual-actions.md);
[§7 of the infrastructure runbook](infrastructure-runbook.md#7-ses-email-provider-infra) carries the
reasoning. Until the two are done, every send resolves to `not_configured` rather than failing.

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

**The retry cadence is one attempt per day, and that is the whole of it.** Nothing polls the send
queue — the daily tick is the only thing that reads `next_attempt_at` — so a message SES refuses at
09:00 is next attempted at 14:00 UTC the following day, not minutes later. Three daily passes is the
whole budget (`RETRY_WINDOW_MS` in `src/db/notifications.ts`, derived from
`DAILY_TICK_INTERVAL_MS`); after the third the row is parked as `failed` for the staff-visible
failure surface rather than retried a fourth time, so a human sees it while the trip it concerns is
still ahead of the shop.

This used to read as a 30s → 1h exponential ladder in the code, which described a system that does
not exist: under a once-a-day drain every rung of it collapsed to "tomorrow", and the eight attempts
sized for that ladder stretched to eight days (OPS-6). If you need faster than daily, the change is a
hosting-plan one — a second, sub-daily `crons` entry in `vercel.json` — and both the schedule
constant and the retry window move together, because `src/lib/cron-schedule.ts` is where the cadence
lives and `src/lib/cron-schedule.test.ts` reads `vercel.json` and fails if they disagree.

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
   `SesDkimRecords` CNAME records with the project Vercel CLI and wait for AWS to show the identity verified:
   ```bash
   pnpm exec vercel dns add dive.day <selector>._domainkey.ses CNAME <value-from-SesDkimRecords>
   ```
   Run that once for each output pair, dropping the trailing `.dive.day` from the record name. A subdomain,
   not the org domain: automated mail and human correspondence should not share a sending
   reputation, and this keeps a bulk-mail problem from affecting the address people actually write to
   you at.
2. **Request SES production access** (an AWS Support case — CDK cannot do this). SES starts in
   sandbox mode, which can only send to pre-verified recipient addresses.
3. **Collect the sender credentials.** The deploy already minted them and writes all three target
   dotenv files; take the `SES_AWS_*` lines from `.env.local`:
   ```bash
   pnpm infra:deploy
   ```
   Store them only in the deploy environment's settings — never the repo. The post-deploy sync
   uses the `diveday-admin` profile by default; set `INFRA_ENV_SYNC_PROFILE` for a differently
   named administrator profile. See
   [§10 of the infrastructure runbook](infrastructure-runbook.md#10-the-credentials-secret).
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

These are added through Vercel CLI: authoritative DNS for `dive.day` is **Vercel DNS**, not Route53,
so the CDK stack has no hosted zone to write them into. It configures the AWS side and prints the
values; add the MAIL FROM pair with:

```bash
pnpm exec vercel dns add dive.day mail.ses MX feedback-smtp.<region>.amazonses.com 10
pnpm exec vercel dns add dive.day mail.ses TXT 'v=spf1 include:amazonses.com ~all'
```

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

A correctly signed message from the *right* topic is also refused once it is **more than an hour
old**, or dated more than five minutes in the future (`MAX_AGE_MS` / `MAX_FUTURE_MS` in
`src/lib/notifications/sns.ts`; the same check covers `/api/webhooks/sms`, which shares the
verifier). SNS signs the publish timestamp along with everything else, so without reading it a
captured message stays valid forever — harmless while a replay could only re-apply an idempotent
delivery status, and not harmless the moment an event writes something a person can undo, such as a
`Complaint` that opts an address out of courtesy mail. Both windows are wall-clock against this host: a host whose clock has drifted by more
than five minutes will refuse live traffic, and the symptom is a run of 400s from an endpoint whose
signatures all verify.

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

The configuration set also adds a hard-bounced or complained-about address to SES's account-level
suppression list. That is the send-time safeguard: it prevents every later notification path from
repeating a known-bad send and protects the account's reputation while staff investigate the contact
record. Do not remove a suppression entry merely to retry an address; first confirm that the address
is valid and that the recipient expects the mail.

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
forwards to the lawyer. `support@dive.day` (general contact) and `onboarding@dive.day` (trial →
paid upgrades) are the two addresses the app itself renders on public and staff surfaces
(`src/lib/platform-mail.ts`) — both route to the same small team as `aaron@`, just without a named
individual's address attached to a support promise (see the product-owner decision retiring
founder-direct support in docs/product/human-decisions.md). Attachments, threading, search,
replying, and mobile all come from the mail provider rather than from us.

**MX records name one mail host.** `dive.day`'s MX must point at the mail provider. Do not also
configure inbound receiving on `ses.dive.day` — mail delivery and the transactional-sending identity
are separate concerns, and the app doesn't handle inbound mail events in any case.

Setup, once:

1. Point `dive.day`'s MX at the provider and add the DKIM records it gives you.
2. Create `aaron@dive.day` as a real mailbox (a licensed user).
3. Create `legal@dive.day` as a **group with the lawyer's address as an external member**, not a raw
   forwarding rule — a group survives adding a second reader and handles forwarded-mail
   authentication better.
4. Create `support@dive.day` and `onboarding@dive.day` the same way as `legal@` — groups, not raw
   forwards — so either can pick up a second reader later without a DNS/mail-provider change.
5. Send a test message with an attachment to each and confirm it arrives intact.

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
| Sends fail `403 AccessDeniedException` and the resource ARN is the **configuration set** (`configuration-set/diveday-transactional-email`) | The sender user is missing that resource — redeploy the stack. A send is authorized against every SES resource it touches, and the config set is attached to the identity, so it is on every send; CDK's `grantSendEmail` adds the identity ARN alone, so the stack now grants the config set explicitly alongside it. Nothing else masks this one: it fails even to the mailbox simulator, since it has nothing to do with the recipient |
| Sends fail `403 AccessDeniedException` on `ses:SendEmail`, and the resource ARN is a **personal mailbox** (`identity/someone@gmail.com`) | Still in sandbox mode. Read the ARN before assuming it's the sender: a pre-verified sandbox *recipient* is an identity too, and it becomes a resource the send is authorized against. The stack grants `diveday-ses-sender` the `ses.dive.day` domain identity and nothing else (`sesEmailIdentity.grantSendEmail`), so a send to a pre-verified recipient is denied on the recipient's identity even though the From address is fine — which is exactly what the step-5 "book a seat with your own Gmail address" test does. **Production access is the fix** (step 2 above): out of the sandbox there is no recipient identity to authorize against. Don't widen the IAM policy to paper over it — the grant is deliberately narrow and the sandbox is temporary |
| Sends fail `403 AccessDeniedException` and the resource ARN is the **sender** | `SES_FROM_EMAIL` is off `ses.dive.day` — the only identity the sender user was granted. Point it at an address on that domain and redeploy |
| Sends fail with a `MessageRejected` | Sandbox mode again, but with a recipient that was never pre-verified — verify it, or request production access |
| Sends fail `400 BadRequestException` with `Missing final '@domain'`, on **every** send, in production only | The deployed `SES_FROM_EMAIL` has literal `"` characters around it, so SES reads a display name with no address after it. Local and CI are fine because Next.js reads `.env.local` through a real dotenv parser, which unquotes — this only ever shows up in the deployed environment. Fixed in `scripts/dotenv.mjs`, which now unquotes on the way *out* of a generated file and re-quotes on the way in, but **the corrected value still has to be pushed**: re-run `node scripts/import-vercel-env.mjs .env.vercel production`, then redeploy. Confirm with the value Vercel holds, not with `.env.local` (issue #517) |
| Sends report `delivered`, diver says nothing arrived | Their spam folder; then DKIM/SPF/DMARC on `ses.dive.day` |
| Mail to `aaron@`/`legal@` never arrives | MX records on `dive.day`; then the provider's own logs. Nothing about this path runs in DiveDay |
| The lawyer stops receiving forwarded mail | DMARC alignment on the forwarded hop — see above; check the group's config before assuming a DNS problem |
