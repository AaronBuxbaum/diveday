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

### Which region

**`us-east-1`**, while the rest of the estate is still in us-east-2
(ADR [20260924-mail-back-in-us-east-1](../architecture/decisions/20260924-mail-back-in-us-east-1.md)).
The sandbox is per region. Mail went to us-east-2 after us-east-1 refused production access in
August (ADR [20260910-one-region-in-us-east-2](../architecture/decisions/20260910-one-region-in-us-east-2.md));
the us-east-2 case was then closed in September with no decision, and mail came back to us-east-1,
the region the whole estate is returning to, for a new request there.

Mail still has its own stack, `diveday-email`, holding everything CloudFormation can only create in
the sending region: the identity, the configuration set, the event topic, the two reputation alarms,
and the inbound receipt rule set with its bucket and topic. **Receiving is why the rule set is
there** — SES receives only for an identity verified in the *receiving* region, so a rule set one
region over deploys cleanly and receives nothing at all.

Everything else — the `diveday-ses-sender` IAM user, its key, and the credentials document — stays in
`diveday-infra`. One constant decides the region, `SES_REGION` in `config/aws-regions.mjs`, and it
stays a separate constant from `PRIMARY_REGION` on purpose: mail is the one part of this estate whose
region AWS gets a vote in.

Practically, **every `aws ses*` and SES-topic `aws sns` command on this page wants
`--region us-east-1`**, and the SES console has to be switched to it. A call to the wrong region does
not say "wrong region" — it says the identity does not exist.

### Moving mail to another region

Changing `SES_REGION` and deploying is not enough on its own: a deploy into the new region never
touches the stack in the old one, and `diveday-inbound-mail` is a global bucket name the old stack
still holds (`RemovalPolicy.RETAIN`). `pnpm infra:migrate-region` moves `PRIMARY_REGION` and does not
do this. Pre-pilot, nothing in the old stack is worth keeping, so the move is a teardown. In order,
with the `diveday-admin` profile, `<old>` the region mail is leaving and `<new>` the new `SES_REGION`:

1. **Deactivate the old receipt rule set.** CloudFormation cannot delete an active one, and the stack
   deletion fails part-way if you skip this:
   `aws ses set-active-receipt-rule-set --region <old>` (no rule-set name deactivates).
2. **Delete the old email stack**, then the bucket it leaves behind:
   ```bash
   aws cloudformation delete-stack --region <old> --stack-name diveday-email
   aws cloudformation wait stack-delete-complete --region <old> --stack-name diveday-email
   aws s3 rm s3://diveday-inbound-mail --recursive
   aws s3api delete-bucket --bucket diveday-inbound-mail
   ```
   The global name can take a few minutes to free after the delete; a `BucketAlreadyExists` or
   `OperationAborted` on the next step means wait and rerun.
3. **Bootstrap and deploy.** `pnpm infra:bootstrap` covers every region in `DEPLOY_REGIONS`, then
   `pnpm infra:deploy`. The main stack's grants and the credentials document's `SES_AWS_REGION` and
   topic ARNs follow the constant.
4. **Redo the DNS** from the new `SesDkimRecords`, `SesMailFromRecords` and `SesInboundMxRecord`
   outputs: three new DKIM CNAMEs (delete the old region's three), and both MX records as a
   delete-then-add. The post-deploy wizard at the end of `pnpm infra:deploy` does the adds and names any rival MX to remove.
5. **Activate the rule set** in the new region:
   `aws ses set-active-receipt-rule-set --region <new> --rule-set-name diveday-inbound`.
6. **Redeploy the app** so it reads the new region and ARNs, then confirm the three SNS subscriptions
   in the new region — the event webhook, the inbound webhook and the SES alarm topic's email — are
   real ARNs, not `PendingConfirmation`.
7. **Run [Before you file](#before-you-file)** in the new region, including the two mailbox-simulator
   sends, then [file the case](#where-to-file-it) there. The new region starts in the sandbox.

| Variable | Enables | Without it |
| --- | --- | --- |
| `SES_AWS_REGION` / `SES_AWS_ACCESS_KEY_ID` / `SES_AWS_SECRET_ACCESS_KEY` | Sending | Nothing sends |
| `SES_FROM_EMAIL` | The sender on every outbound email | Nothing sends |
| `SES_SNS_TOPIC_ARN` | `/api/webhooks/ses` | The endpoint answers 503; a bounce stays invisible |

## Sending to divers

1. **Verify `ses.dive.day`** — deploy both stacks (`pnpm infra:deploy`; the identity is in
   `infra/lib/email-stack.ts`), then add the three
   `SesDkimRecords` CNAME records with the project Vercel CLI and wait for AWS to show the identity verified:
   ```bash
   pnpm exec vercel dns add dive.day <selector>._domainkey.ses CNAME <value-from-SesDkimRecords>
   ```
   Run that once for each output pair, dropping the trailing `.dive.day` from the record name. A subdomain,
   not the org domain: automated mail and human correspondence should not share a sending
   reputation, and this keeps a bulk-mail problem from affecting the address people actually write to
   you at.
2. **Request SES production access** (an AWS Support case — CDK cannot do this), in **us-east-1**.
   SES starts in sandbox mode, which can only send to pre-verified recipient addresses. The case is
   written out below in [Production access: the request](#production-access-the-request) — paste
   that text, do not improvise a shorter one.
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
| MX | `10 feedback-smtp.us-east-1.amazonses.com` — the region must match `SES_AWS_REGION`; a move re-points it |
| TXT | `v=spf1 include:amazonses.com ~all` |

**Exactly one MX record.** SES fails the whole MAIL FROM setup if that subdomain has more than one.
Moving regions is therefore a delete-then-add, and it is yours to do: the post-deploy wizard finds a
rival MX, prints it with the `pnpm exec vercel dns rm <record-id>` to remove it, and skips its own
add rather than leaving two behind.

These are added through Vercel CLI: authoritative DNS for `dive.day` is **Vercel DNS**, not Route53,
so the CDK stack has no hosted zone to write them into. It configures the AWS side and prints the
values; add the MAIL FROM pair with:

```bash
pnpm exec vercel dns add dive.day mail.ses MX feedback-smtp.us-east-1.amazonses.com 10
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
aws sesv2 get-email-identity --region us-east-1 --email-identity ses.dive.day \
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
| `Reply-To: reply+<token>@inbound.ses.dive.day` | `shops.inbound_email_token`, minted by the database for every shop; a diver's reply lands on their record and in the shop's inbox (ADR [20260907-two-way-inbox](../architecture/decisions/20260907-two-way-inbox.md), [Mail divers send back](#mail-divers-send-back) below) | Only when inbound mail is switched off (`EMAIL_INBOUND_DOMAIN=`): then the confirmed front desk, `shops.contact_email` once the shop opened the confirmation link (`shops.contact_email_confirmed_at`, issue #1288), and nothing at all until it has |
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

## Production access: the request

The sandbox is **per region**, and each request is judged on its own text. What decides one is
whether the reviewer can tick every row of their checklist from what is in front of them — a
one-paragraph "we send booking confirmations" is the shape that gets refused. AWS's own guidance adds
two things this text now does: say whether an earlier request was denied, and describe what changed
since ([AWS Messaging Blog](https://aws.amazon.com/blogs/messaging-and-targeting/how-large-senders-can-move-from-sandbox-to-production-using-amazon-ses/)).

### Case history

Add a row when a case moves. The next request names every earlier one, so this table is its source.

| Case | Region | Filed | Outcome |
| --- | --- | --- | --- |
| 178576512200471 | us-east-1 | 2026-08-03 | Follow-up answered; refused Aug 5 and Aug 6 with no reason, closed as final Aug 15 ("identifiable patterns and signals"). |
| 178839371400539 | us-east-1 | 2026-09-02 | Asked why. AWS's automated reply (Sep 3): submit a **new** request that describes what changed since the refusal. |
| 178905641100543 | us-east-2 | 2026-09-10 | Follow-up answered within 25 minutes with the case text; closed with no decision. Two comments on the closed case (Sep 12, Sep 14) drew no reply — a comment on a closed case does not reach the reviewer, so open a new one. |
| — | us-east-1 | pending | The text below, after [Moving mail to another region](#moving-mail-to-another-region). |

### Before you file

Every one of these is something the reviewer may check, and every one is done by a deploy of this
repository plus the DNS steps above. Confirm, do not assume:

```bash
aws sesv2 get-email-identity --region us-east-1 --email-identity ses.dive.day \
  --query '{dkim:DkimAttributes.Status,mailFrom:MailFromAttributes.MailFromDomainStatus,verified:VerifiedForSendingStatus}'
# want: dkim SUCCESS, mailFrom SUCCESS, verified true
aws sns list-subscriptions-by-topic --region us-east-1 --topic-arn <SesEventNotificationsTopicArn> \
  --query 'Subscriptions[].SubscriptionArn'
# want: a real ARN, not PendingConfirmation
aws sesv2 get-configuration-set --region us-east-1 \
  --configuration-set-name diveday-transactional-email \
  --query 'SuppressionOptions.SuppressedReasons'
# want: BOUNCE and COMPLAINT -- this is where the stack sets them (infra/lib/email-stack.ts)
aws sesv2 get-account --region us-east-1 \
  --query '{production:ProductionAccessEnabled,suppression:SuppressionAttributes}'
# want: production false until the case below is granted. SuppressionAttributes is the
# *account default*, which the configuration set overrides and this stack never sets --
# so read it for information, never as proof that DiveDay's mail is suppressing.
dig +short TXT _dmarc.ses.dive.day
# want: v=DMARC1; p=none (at least), carrying a rua= address that someone reads. This is the
# record that governs SES mail: DMARC reads the From domain's own record and only walks up to
# dive.day when there isn't one. _dmarc.dive.day is a CNAME to the mail provider's shared record
# and is not ours to edit -- read it for information, never as this identity's policy.
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

1. **A new case, filed in `SES_REGION`** — us-east-1 today. The **Request production access** button
   on the SES console's *Get set up* page, switched to that region: choose **Transactional**,
   website `https://dive.day`, contacts `aaron@dive.day`. The form has no free-text field; the case
   it opens does, so paste the whole text below into that case as soon as it exists rather than
   waiting for the reviewer to ask. Never reopen a closed case with a comment.
2. **Answer any follow-up inside 48 hours**, on the same case. The questions are the standard set in
   the table after the case text. A case that goes quiet is closed as refused.
3. **Ask the account team in parallel.** An *Account and billing* case or chat is free on Basic
   support. Ask whether account 417160702652 still carries a verification or risk hold that affects
   SES (it had one for CloudFront in early September), and ask them to route the new case to the SES
   team. A new account with little billing history is the most common reason given for a no-reason
   refusal, and no case text fixes it.
4. **A support plan.** Developer Support ($29/month, cancel after) gives a named engineer on the
   case who can ask the SES team which row failed. Take it before another attempt, not after.
5. **Not another region.** The reviewer sees the whole account's history, and if the account is the
   problem, a third region is the same answer after another round of DNS.

### The case text

Send it whole. Every paragraph is a row of the reviewer's checklist, in the order their follow-up
email asks: how often, how addresses are kept, bounces and complaints and unsubscribes, samples. The
samples are rendered by `messageFor` (`src/lib/notifications/render.ts`) from made-up data; when a
kind is added, add it to *What we send*. Update the history and the volume line before each filing.

```text
Subject: SES production access for dive.day in us-east-1 (transactional)

Summary
DiveDay (https://dive.day) is booking software for scuba dive shops. We need SES to send one-to-one transactional mail - booking confirmations, waiver links, trip reminders, weather cancellations, password resets - to divers and shop staff, about 50-300 messages a day across 10 pilot shops from November 2026. Every address is typed by the recipient or their dive shop; we have no bulk-send feature. The sending domain ses.dive.day is verified in us-east-1 with DKIM, a custom MAIL FROM domain and its own DMARC record, and bounce and complaint handling is built and tested.

Previous requests, and what has changed since
- Case 178576512200471 (us-east-1, Aug 3-15): refused without a specific reason.
- Case 178905641100543 (us-east-2, Sep 10): I answered the follow-up the same day and the case was closed without a decision.
AWS Support (case 178839371400539) advised a new request describing what changed after the refusal. Since August 15 we have:
- Set Reply-To on every message to the dive shop's own front-desk address, used only after the shop confirms that address by clicking a link we send to it. Before, replies went to an unmonitored noreply address.
- Added the shop's postal address to every optional (commercial) message, alongside the one-click unsubscribe it already had.
- Made a spam complaint opt the address out of every optional message in our own records, not just SES's suppression list, and tagged every send with its shop and message type so each complaint is traceable to the shop that caused it.
- Added CloudWatch alarms on Reputation.BounceRate (5%) and Reputation.ComplaintRate (0.1%).
- Published a DMARC record for the sending subdomain itself, with aggregate reports to an address we read.
- Tested bounce and complaint handling end to end against the mailbox simulator.
- Written out below every message type the product can send, with real subjects and a full sample.

Who we are
DiveDay is built and operated by Aaron Buxbaum (aaron@dive.day), a US sole proprietor. The whole product already runs on this AWS account (S3, Lambda, CloudWatch, SNS, deployed with CDK); SES is the last piece. Privacy policy: https://dive.day/privacy (names AWS as our email processor and how long delivery records are kept). Terms: https://dive.day/terms.

What we send, and when
All mail is branded as the dive shop and sent from noreply@ses.dive.day. Every message is to one person about one event.
1. About a booking the diver has (the large majority of volume): booking confirmation when the seat is booked; waiver link when the shop requests a waiver; reminders 7 days and 24 hours before departure; weather hold or cancellation, and cancellation for not reaching the minimum number of divers, only to divers booked on that trip; a copy of the signed release to a parent who co-signed a minor's waiver; a gift pass to the person who paid for someone else's seat.
2. Links a person asked for: a replacement trip-prep link when theirs expired; a booking link with their saved details when they type their address into a shop's booking form; their own diver page when shop staff send it from the diver's record.
3. Account mail to shop staff: welcome, email verification, password reset, password-changed notice, staff invitation; and to the shop itself, a course inquiry from its public page and a confirmation of its front-desk address.
4. Optional messages the diver opted into (these carry unsubscribe; see below): a wait-list seat opening, for a trip they joined the wait list for; a last-minute discount, if they joined the shop's last-minute list; one reminder about an unfinished checkout; a post-trip recap.
5. Written by staff, one person at a time: a reply to a diver who wrote to the shop, and an invitation to one named diver for one departure (a diver who asked the shop for that date, or who already dives with that shop). One click sends one message; there is no select-all.

Sample: booking confirmation (full text)
Subject: You're on the boat - Two-Tank Reef
Hi Nora,
Your spot on Two-Tank Reef is confirmed.
Sat, Nov 14, 8:00 AM - 12:00 PM EST
Please be at the dock 30 minutes early. Blue Mantis Divers will take it from there.
Track what's left before you sail: https://dive.day/ready/...
Pre-Trip Checklist Reminder: Certification card, Mask, Fins

Other subject lines, as sent: "Complete your waiver for Two-Tank Reef" / "You sail tomorrow - Two-Tank Reef" / "Conditions hold - Two-Tank Reef" / "Trip cancelled - Two-Tank Reef" / "A spot opened up on Two-Tank Reef" / "Finish booking Two-Tank Reef?" / "Reset your DiveDay password". I can send a full rendered copy of any message type.

How often we send, and volume
Mail is sent only when its event happens; nothing is scheduled in bulk. From November 2026: 10 shops, about 50-300 messages a day (roughly 350-2,000 a week), peaks of about 500 on a busy weekend morning, and a peak rate well under 1 message per second. We are requesting 2,000 messages/day and 5/second, and will open a new case with real numbers before we need more.

How we get and maintain addresses
Every address is typed by the person themselves (booking, checkout, wait-list or last-minute sign-up, course inquiry, account sign-up, a guardian co-signing a waiver) or by shop staff onto that diver's record at the counter. A record a shop imports from a spreadsheet gets no mail until that diver books, is sent a waiver, or is invited individually by staff. We have never bought, rented or scraped a list, and the product cannot send to one. Addresses that bounce or complain are suppressed automatically (below), and the shop sees the failure on that diver's booking so they can correct a typo with the diver.

Bounces and complaints (built and tested)
Our SES configuration set sends BOUNCE, COMPLAINT, DELIVERY, DELIVERY_DELAY, REJECT and RENDERING_FAILURE events to an SNS topic subscribed to our HTTPS endpoint, which checks the SNS signature and topic ARN before acting. Each outcome is recorded against the message that produced it and shown to the shop on their dashboard. The configuration set suppresses BOUNCE and COMPLAINT, so those addresses are never mailed again. A complaint also opts the address out of every optional message in our own records. We have tested this end to end from the deployed app against the mailbox simulator (bounce@ and complaint@). CloudWatch alarms on Reputation.BounceRate (5%) and Reputation.ComplaintRate (0.1%) notify our operations mailbox. We do not use open or click tracking.

Unsubscribe
Every optional message (group 4) carries RFC 8058 one-click List-Unsubscribe and List-Unsubscribe-Post headers, an in-body link that never expires, and the shop's postal address. Messages about a booking that exists, and mail a person asked for, carry no unsubscribe because they are the service itself; cancelling the booking or closing the account ends them.

Sending identity
Verified domain ses.dive.day in us-east-1: Easy DKIM (three CNAMEs, SUCCESS), custom MAIL FROM mail.ses.dive.day (MX and SPF, SUCCESS), and its own DMARC record (p=none, aggregate reports to an address we read). dive.day, our human mail domain, publishes p=reject; automated mail stays on its own subdomain so the two never share reputation. abuse@dive.day and postmaster@dive.day are monitored. Every message has text and HTML parts and Auto-Submitted: auto-generated.

Happy to answer anything else here in this case.
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
| "Is this mail marketing?" | "No. Every message is triggered by an action the recipient or their dive shop took, addressed to that one person about that one event. The four optional kinds are opt-in and carry one-click unsubscribe" |
| "Who can replies reach?" / "How do you know the Reply-To address is the sender's?" | "Reply-To is the dive shop's own front-desk address, and we set it only after the shop has opened a one-time link we sent to that address (`shops.contact_email_confirmed_at`). A changed address starts unconfirmed again. Until then messages carry no Reply-To at all" |

Record the outcome in [Case history](#case-history) when it comes, so the next person does not
start from the same blank page.

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

## Mail divers send back

Every email the app sends carries `Reply-To: reply+<token>@inbound.ses.dive.day`, and a reply to
it lands on the diver's record and in the shop's inbox at `/shop/<slug>/inbox`
(ADR [20260907-two-way-inbox](../architecture/decisions/20260907-two-way-inbox.md)). The path is
SES receipt rule → S3 → SNS → `POST {APP_HOST}/api/webhooks/email-inbound`.

**What the stack creates** (`infra/lib/email-stack.ts`): the private inbound bucket
(`diveday-inbound-mail`, objects expire after 30 days), the `diveday-ses-inbound-mail` topic with
the webhook subscribed, and the `diveday-inbound` receipt rule set with one rule — recipients
`inbound.ses.dive.day`, spam and virus scan on, action *store to S3 and notify the topic*. The
receiving domain is a child of the verified `ses.dive.day` identity, so it needs no verification
of its own. The SES sender user gets `s3:GetObject` on the bucket and nothing else new.

**What is yours**, both in the manual-action registry at §17 of `infra/lib/infra-stack.ts`
(`ses-inbound-mx-dns` and `ses-inbound-rule-set-active`; neither is on the short account-approval
list that renders to [manual-actions.md](manual-actions.md)): the MX record for
`inbound.ses.dive.day` (Vercel DNS, the `SesInboundMxRecord` output spells it out), and
activating the rule set — `aws ses set-active-receipt-rule-set --region us-east-1 --rule-set-name diveday-inbound`.
SES allows one active set per region and the switch has no CloudFormation resource, so the stack
never flips it. Then set `EMAIL_INBOUND_SNS_TOPIC_ARN` and `EMAIL_INBOUND_S3_BUCKET` from the
outputs (`pnpm infra:deploy` writes both) and redeploy the app; until they are set the route
answers 503 and the subscription sits `PendingConfirmation`, same recovery as the delivery
webhook above.

**What the webhook does, in the order it trusts things.** Verifies the SNS envelope's signature,
topic and freshness (`src/lib/notifications/sns.ts`); refuses a notification naming any bucket
but the configured one; resolves the `reply+<token>` recipient to a shop
(`shops.inbound_email_token`) and drops mail for a token nobody holds; only then reads the object
(capped at 2 MB), takes the `text/plain` part with the quoted history cut
(`src/lib/inbound-email.ts`), and files it against the diver whose `people.email` matches the
sender inside that shop — or as an unknown sender when none does.

**Which address counts as the sender is SES's call, not the message's.** The reply-to address
rides on every email a shop sends, so anyone who has ever had one can post here, and a `From:`
header costs nothing to write. So the header address is used when SES's **DMARC** verdict passed
(the only verdict that authenticates that header), or when **SPF** passed and the envelope sender
agrees with it — between them, the ordinary reply, including from the many domains publishing no
DMARC record. With neither, the row keeps the envelope's own address and is matched to nobody, so
an unauthenticated message reads as an unknown sender rather than as words on a named diver's
record. A virus verdict is refused; a spam verdict is kept, because a diver's reply from hotel
Wi-Fi trips it too often. Attachments are counted, never fetched. A failed S3 read answers 500 so
SNS retries; everything else verified answers 200.

**Reading a raw message by hand** — the bucket keeps SES's copy for 30 days:

```bash
aws s3 cp s3://diveday-inbound-mail/mail/<ses message id> - | less
```

**Switching it off** for a fork or a staging deploy: `EMAIL_INBOUND_DOMAIN=` (set empty) puts
`Reply-To` back on the shop's confirmed front-desk address with no code change.

**SMS is one-way.** SNS cannot receive a text; two-way SMS needs a dedicated number through AWS
End User Messaging and is tracked as a `waiting-on-external` issue. The inbox's model already
carries an `sms` channel for the day it lands.

## DiveDay's own addresses

Not built into the app, on purpose — `aaron@dive.day` is a hosted mailbox and `legal@dive.day`
forwards to the lawyer. `support@dive.day` (general contact) and `onboarding@dive.day` (trial →
paid upgrades) are the two addresses the app itself renders on public and staff surfaces
(`src/lib/platform-mail.ts`) — both route to the same small team as `aaron@`, just without a named
individual's address attached to a support promise (see the product-owner decision retiring
founder-direct support in docs/product/human-decisions.md). Attachments, threading, search,
replying, and mobile all come from the mail provider rather than from us.

**Three subdomains, three different MX answers.** `dive.day`'s MX names the mail provider and
nothing else — human mail is the provider's job, and a second host there would split it. The
sending identity `ses.dive.day` carries no MX at all; its custom MAIL FROM subdomain
`mail.ses.dive.day` carries exactly one, `feedback-smtp.<region>.amazonses.com`, and SES fails the
setup outright if that subdomain has more than one. Inbound receiving for machine-parsed diver
replies lives on a third subdomain of its own, `inbound.ses.dive.day`, so it collides with neither
the human mailboxes nor the sending identity — see [Mail divers send back](#mail-divers-send-back)
for what reads that mail.

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
3. Publish DMARC at `_dmarc.ses.dive.day` starting permissive, with an aggregate reporting address:
   `v=DMARC1; p=none; rua=mailto:<a dive.day mailbox someone reads>` (manual action `dmarc-dns`,
   in the registry at §17 of `infra/lib/infra-stack.ts`). That record is the one SES mail is judged by —
   a receiver reads the From domain's record and only walks up to `dive.day` when there isn't one.
4. **Leave `_dmarc.dive.day` alone.** It is a CNAME to the mail provider's shared record
   (`p=reject`, with the provider's own `ruf`), so it is the provider's policy for human mail and
   not ours to edit; taking it over would mean replacing the CNAME with our own TXT.
5. **Read the aggregate reports for a couple of weeks.** Move the *sending subdomain* to
   `p=quarantine` only once both senders show aligned in them, then to `p=reject`. Jumping straight
   to `reject` is how you discover a misaligned sender by having your mail disappear. `rua` is what
   receivers actually send; `ruf` failure reports carry message content and most receivers suppress
   them, so a record with only `ruf` reports nothing you can act on.

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
