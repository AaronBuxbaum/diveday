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
   sandbox mode, which can only send to pre-verified recipient addresses. The first request was
   refused; the second is written out below in
   [Production access: the second request](#production-access-the-second-request) — paste that text,
   do not improvise a shorter one.
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

### What every message carries

Beyond the body, three things a receiving mailbox and a reviewer both read
(ADR [20260902-sender-standards-for-ses](../architecture/decisions/20260902-sender-standards-for-ses.md)):

| | Where it comes from | When it is absent |
| --- | --- | --- |
| `Reply-To: <the shop's front desk>` | `shops.contact_email`, once the shop has opened the confirmation link sent there (`shops.contact_email_confirmed_at`, the `/confirm-contact/[token]` page; issue #1288). Any change to the address starts it unconfirmed again, and the settings row says "Awaiting confirmation" until it is | The shop has none on file, or has not confirmed it; a reply then goes to `noreply@ses.dive.day` and nobody |
| `Auto-Submitted: auto-generated` (RFC 3834) on every message | Always | Never — a diver's out-of-office or ticketing auto-responder stays quiet instead of answering a booking confirmation |
| A closing line `Shop name · street, town, region postcode, country` on every **commercial** message (the kinds carrying an unsubscribe link: wait-list invite, last-minute deal, checkout recovery, recap) | `shops.address_*` | The shop has no street on file; nothing is guessed and no blank line is rendered |
| `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058 one-click) on those same kinds | The notification's own `unsubscribeUrl` | Never absent on a commercial kind — `kinds.ts` makes the URL required there |
| SES message tags `diveday_shop` and `diveday_kind` | The notification | Never — every send is tagged, and every event SES publishes echoes them back |

Both shop-sourced values are resolved once per send in `src/db/notifications.ts` (`shopSenderFor`),
never by the composer, so a new kind gets them for free. Transactional mail (a confirmation, a waiver
link, a reminder) carries the `Reply-To` and nothing else.

Bounce and complaint feedback reaches the app **only** through the SNS event destination below: the
identity's email feedback forwarding is off (`feedbackForwarding: false` in the stack), so SES does
not also mail each bounce to `noreply@ses.dive.day`, a mailbox nobody reads. The configuration set
publishes its own reputation metrics beside the account-level ones the two alarms read, so when the
account rate moves the graph says whether it was DiveDay's mail.

## Production access: the second request

The first request was refused with AWS's standard wording — no reason given, "this decision is
final". Read that for what it is: the verdict on one case, by one reviewer, against whatever that
case said. It is not a mark on the account (`aws sesv2 get-account` reports `ProductionAccessEnabled:
false` and nothing else), and the sandbox is **per region**, so it is not even a verdict on the
account in every region. Second requests are reviewed like first ones. What decides them is whether
the reviewer can tick every row of their checklist from the text in front of them — a one-paragraph
"we send booking confirmations" is the shape that gets refused, and the case below is the shape that
does not.

### Before you file

Every one of these is something the reviewer may check, and every one is done by a deploy of this
repository plus the DNS steps above. Confirm, do not assume:

```bash
aws sesv2 get-email-identity --email-identity ses.dive.day \
  --query '{dkim:DkimAttributes.Status,mailFrom:MailFromAttributes.MailFromDomainStatus,verified:VerifiedForSendingStatus}'
# want: dkim SUCCESS, mailFrom SUCCESS, verified true
aws sns list-subscriptions-by-topic --topic-arn <SesEventNotificationsTopicArn> \
  --query 'Subscriptions[].SubscriptionArn'
# want: a real ARN, not PendingConfirmation
aws sesv2 get-configuration-set --configuration-set-name diveday-transactional-email \
  --query 'SuppressionOptions.SuppressedReasons'
# want: BOUNCE and COMPLAINT -- this is where the stack sets them (infra-stack.ts S8)
aws sesv2 get-account --query '{production:ProductionAccessEnabled,suppression:SuppressionAttributes}'
# want: production false until the case below is granted. SuppressionAttributes is the
# *account default*, which the configuration set overrides and this stack never sets --
# so read it for information, never as proof that DiveDay's mail is suppressing.
dig +short TXT _dmarc.dive.day
# want: v=DMARC1; p=none (at least); the rua= address must exist
```

Then send to the mailbox simulator from the deployed app — book a seat with
`bounce@simulator.amazonses.com`, then one with `complaint@simulator.amazonses.com` — and confirm the
bounce shows on the shop's dashboard as an email issue and the complaint opted that address out
(`people.courtesy_email_opt_out_at` set, the `ses_webhook.complaint_opt_out` log line). That is the
"we have tested our bounce and complaint handling" sentence made true.

**Three AWS-side dials cannot confirm this test, and looking at them will tell you it failed when it
did not.** The simulator is excluded from all of them by design — otherwise a single bounce test
would poison the account it is meant to protect:

| Where you might look | What you will see | Why |
| --- | --- | --- |
| `Reputation.BounceRate` / `Reputation.ComplaintRate`, and the two alarms on them | Nothing, ever | "Emails that you send to the mailbox simulator don't impact your email deliverability or reputation metrics" ([mailbox simulator considerations](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html#send-email-simulator-considerations)). The sandbox publishes no rate at all either, so this stays blank twice over |
| `aws sesv2 list-suppressed-destinations` | Neither address | "The mailbox simulator email address isn't placed on the Amazon SES suppression list, which would normally happen when a hard bounce occurs" (same page, the `bounce@` row). AWS states this for `bounce@`; `complaint@` is undocumented either way, so do not read its absence as a fault |
| Virtual Deliverability Manager | Nothing | Excluded with the reputation metrics, in the same sentence |

The evidence is app-side and nowhere else: the `ses_webhook.delivery_applied` line with a `bounced`
or `complained` status, the `notification_deliveries` row it wrote, and — for the complaint —
`ses_webhook.complaint_opt_out`. Those lines are in CloudWatch Logs under `/diveday/app`
— **Logs Insights**, `filter event like /ses_webhook/`, and note they are `info` level, so the
saved *DiveDay/Errors* query will not show them — and unconditionally on stdout in Vercel's own log view, which is the faster look and the one that
still works when log shipping is misconfigured. If they are absent in *both*, the problem is the
SNS→webhook leg rather than anything on this page: check `SES_SNS_TOPIC_ARN` is set in the running
deployment (`/api/webhooks/ses` answers 503 without it, before it reads the event) and that the
subscription is not `PendingConfirmation`. If they are on stdout but not in CloudWatch, it is the
shipper, not SES — see
[**When something doesn't arrive**](cloudwatch-observability-runbook.md#when-something-doesnt-arrive),
whose first row is the four `CLOUDWATCH_*` variables, a partial set of which is treated as unset.

### Where to file it

In order. Stop at the first that works.

1. **The same case, or a new one naming it.** In the Support Center, reply on the closed case if it
   still accepts replies; otherwise open a new case — *Account and billing* → *Service* SES →
   *Category* Sending limits (or the **Request production access** button on the SES console's
   *Get set up* page, which opens the same kind of case). Choose **Transactional**, website
   `https://dive.day`, contacts `aaron@dive.day`. Put the whole text below in the case body, with
   the previous case id filled in. The console form has no free-text field any more; the case it
   opens does, and the reviewer's follow-up ("please describe your use case in more detail") is
   where the text goes if the form gave you nowhere.
2. **Answer the follow-up inside 48 hours.** The reviewer's questions are the standard set in the
   table after the case text. A case that goes quiet is closed as refused.
3. **A second region.** The sandbox is per region, and a refusal in one carries no automatic weight
   in another. The stack sends from `this.region`, so this is a real move: deploy the stack in the
   new region, re-add the DKIM and MAIL FROM records it prints, redeploy the app with the new
   `SES_AWS_REGION`, then request production access there with the same text. Worth it only if the
   first region refuses a second time.
4. **A support plan.** Developer Support ($29/month, cancel after) gives a named human on the case
   who can tell you which row failed; Business Support adds chat. Neither changes the reviewer, but
   both change "no reason given". Take this before a third attempt, not after.

### The case text

Fill the three bracketed values. Send it whole — the length is the point; the reviewer is looking
for the rows, and every paragraph is one of them.

```text
Subject: SES production access for dive.day (transactional; previous case [PREVIOUS CASE ID])

Who we are
DiveDay (https://dive.day) is booking and operations software for scuba dive shops: trip
scheduling, seat booking, liability waivers, certification checks, boat manifests. It is built and
operated by Aaron Buxbaum (aaron@dive.day), a US sole proprietor. The product is pre-launch with
[N] pilot dive shops onboarding in [MONTH YEAR]. Our privacy policy (https://dive.day/privacy)
names AWS as the processor for email and how long delivery records are kept; our terms are
https://dive.day/terms.

What we send, and what triggers it
Transactional mail only, one message per recipient per event, each triggered by an action the
recipient or their dive shop took in the product:
- Booking confirmation, when a diver books a seat on a trip (or a shop books it for them at the
  counter).
- Waiver link, when a shop sends a diver their liability waiver to sign.
- Trip reminders 7 days and 24 hours before departure, only for a booked seat.
- Trip changes: a departure put on hold for conditions, cancelled for weather, or cancelled for
  not meeting its minimum - only to the divers booked on it.
- Account mail to shop staff: email verification, password reset, staff invitation, welcome.
- Three courtesy messages a diver asked for: a wait-list seat opening (they joined the wait list
  for that trip), a last-minute deal (they joined the shop's last-minute list on a form), and a
  post-trip recap. These carry a one-click unsubscribe (RFC 8058 List-Unsubscribe and
  List-Unsubscribe-Post headers plus an in-body link) and the shop's postal address.
We do not send newsletters, cold outreach, or anything to a purchased or rented list, and the
product has no feature that could.

Sample: booking confirmation
Subject: You're on the boat - Two-Tank Reef
Hi Nora, you're booked on Two-Tank Reef with Blue Mantis. Sat, Aug 1, 9:00 AM - 1:00 PM EDT.
[button: Track what's left to do] Bring: certification card, mask, fins. See you at the dock.
(The message is branded as the dive shop. Reply-To is the shop's own front-desk address, and
only once the shop has confirmed it by opening a link we send to that address; every message
carries Auto-Submitted: auto-generated.)

How we get addresses
Every address is typed by the diver themselves at booking or on an opt-in form, or by shop staff
onto that diver's record at the counter. A record a shop imports from a spreadsheet receives no
mail until that diver books a trip or is sent a waiver. There is no bulk send; every message is
addressed to one person about one event.

Volume
Launch: [N] shops, roughly 20-60 messages a day, peaks of about 200 on a busy weekend morning, well
under 1 message per second. We are requesting a 1,000/day quota and 5/second; we will ask again
with real numbers before we need more.

Sending identity and authentication
We send from the verified domain identity ses.dive.day (Easy DKIM, all three CNAMEs resolving),
with a custom MAIL FROM domain mail.ses.dive.day (MX and SPF published, status SUCCESS) so the
envelope aligns with our From domain under DMARC. dive.day publishes DMARC with a reporting address,
and abuse@dive.day and postmaster@dive.day are monitored mailboxes. Automated mail is deliberately
on a subdomain so it never shares reputation with our human correspondence. Every message has both
text/plain and text/html parts and an Auto-Submitted: auto-generated header.

Bounce and complaint handling (tested)
Our SES configuration set publishes BOUNCE, COMPLAINT, DELIVERY, DELIVERY_DELAY, REJECT and
RENDERING_FAILURE events to an SNS topic subscribed to our HTTPS endpoint, which verifies the SNS
signature and topic ARN before acting; email feedback forwarding on the identity is off, so the
event stream is the one record. Each outcome is recorded against the message that produced
it and shown to the shop as an email issue on their dashboard. The configuration set enables
account-level suppression for BOUNCE and COMPLAINT, so a hard-bounced or complained-about address
is never sent to again. A complaint additionally opts that address out of every courtesy message in
our own records, and off any list it joined, so the opt-out survives a later change of address.
We have exercised this end to end against the SES mailbox simulator (bounce@ and complaint@) from
the deployed application. We have CloudWatch alarms on the account's Reputation.BounceRate and
Reputation.ComplaintRate at AWS's review thresholds (5% and 0.1%), notifying our operations
mailbox. We do not enable open or click tracking.

Opting out
Courtesy messages carry List-Unsubscribe and List-Unsubscribe-Post one-click headers and an in-body
link; the link never expires, and one click opts the person out permanently. Transactional messages
about a booking that exists (confirmation, waiver, reminders, cancellations) do not carry an
unsubscribe because they are the service the person bought; nobody receives them without a booking.

Previous request
Case [PREVIOUS CASE ID], refused on [DATE] without a stated reason. Since then we have added the
shop's Reply-To address (confirmed by a link sent to it before we use it) and postal footer to our
messages, marked every message Auto-Submitted, made a complaint opt the recipient out in our own
records, added the reputation alarms above, and tested the bounce and complaint path against the
simulator from production. We are happy to answer any question about the above or
provide a full sample of any message type.
```

### The reviewer's follow-up, answered

The follow-up mail, when it comes, is one of these. Answer on the case, not in a new one.

| They ask | Say |
| --- | --- |
| "Describe in detail how you obtain the email addresses you send to" | The *How we get addresses* paragraph, verbatim, plus: "an address reaches our system only through the diver's own booking or opt-in form, or their dive shop's staff typing it onto their record; we hold no list that was not built this way" |
| "How do you handle bounces and complaints?" / "Do you have a process in place?" | The *Bounce and complaint handling* paragraph, plus the two commands: `aws sesv2 get-configuration-set --configuration-set-name diveday-transactional-email --query SuppressionOptions.SuppressedReasons` shows `BOUNCE, COMPLAINT` (the configuration set is where this stack sets them — `get-account` reports the account default, which it overrides); `aws sns list-subscriptions-by-topic` shows the confirmed endpoint |
| "How do recipients opt out?" | The *Opting out* paragraph. If they push on the transactional set: "those messages exist only for a seat the recipient booked and are the confirmation, waiver and reminder for that seat; cancelling the booking ends them" |
| "What is your expected sending volume and rate?" | The *Volume* paragraph with today's real numbers. Ask for less than you think you need; a quota is raised on evidence, in a later case that is routinely approved |
| "Please provide a sample of the email you will send" | Paste the booking-confirmation sample and, if asked for HTML, the `messageFor` output of `pnpm test src/lib/notifications/render.test.ts` — or send a real one to yourself from the deployed app and forward it |
| "Do you have a website / privacy policy?" | `https://dive.day`, `https://dive.day/privacy`, `https://dive.day/terms` |
| "Is this mail marketing?" | "No. Every message is triggered by an action the recipient or their dive shop took, addressed to that one person about that one event. The three courtesy kinds are opt-in and carry one-click unsubscribe" |
| "Who can replies reach?" / "How do you know the Reply-To address is the sender's?" | "Reply-To is the dive shop's own front-desk address, and we set it only after the shop has opened a one-time link we sent to that address (`shops.contact_email_confirmed_at`). A changed address starts unconfirmed again. Until then messages carry no Reply-To at all" |

Record the outcome — case id, date, verdict — in this section when it comes, so the next person
does not start from the same blank page.

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

**A complaint is an unsubscribe.** Every send is tagged with its shop and kind (`diveday_shop`,
`diveday_kind`; `src/lib/notifications/ses-tags.ts`), and SES echoes the tags on every event. On a
`Complaint`, the route opts the complained-about address out of courtesy mail for that shop
(`people.courtesy_email_opt_out_at`) and off every live last-minute-list entry it has there
(`optOutAddressAfterComplaint`, `src/db/courtesy-email.ts`), logging `ses_webhook.complaint_opt_out`
with counts and never the address. It is keyed by address and shop, not message id, because the
courtesy kinds record no id and a complaint on one of them is the whole point. A bounce opts nobody
out — that is a wrong address for a staffer to fix, and the suppression list below already refuses
the next send.

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
5. Create `abuse@dive.day` and `postmaster@dive.day` as groups routing to the same reader. RFC 2142
   names both as the addresses a receiving provider writes to about a sender, mailbox-provider
   feedback loops and blocklist operators use `abuse@`, and a domain that bounces them reads as one
   with nobody accountable behind it — a sender-reputation input, and one a production-access
   reviewer can check in seconds.
6. Send a test message with an attachment to each and confirm it arrives intact.

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
