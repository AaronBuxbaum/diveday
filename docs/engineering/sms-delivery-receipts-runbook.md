# SMS delivery receipts runbook

How DiveDay learns what happened to an SMS after SNS accepted it, how to switch it on, and what to
check when receipts stop arriving. The decision and its trade-offs are in ADR
[20260802-sms-delivery-receipts-in-cloudformation](../architecture/decisions/20260802-sms-delivery-receipts-in-cloudformation.md)
and the record it supersedes.

## Why this is a pipeline and not a webhook

SNS has **no delivery webhook** for a direct-to-phone-number `Publish`. It writes a receipt to
CloudWatch Logs and nowhere else, and a CloudWatch subscription filter cannot target SNS. So:

```
SNS Publish
  └─ receipt → CloudWatch Logs   sns/<region>/<account>/DirectPublishToPhoneNumber[/Failure]
       └─ subscription filter → Lambda  diveday-sms-receipt-forwarder
            └─ SNS topic  diveday-sms-delivery-receipts
                 └─ POST /api/webhooks/sms   (verified as a signed SNS message)
```

The last hop exists so the receipt arrives inside the same signed envelope `/api/webhooks/ses`
already verifies, rather than inventing a fourth inbound auth scheme for one caller.

## Switching it on

1. **Deploy the stack.** `infra/lib/infra-stack.ts` section 10 creates the topic, the IAM role, both
   log groups (two-week retention), the forwarder, the subscription filters, **and switches
   delivery-status logging on**.

   That last part is a custom resource calling `SetSMSAttributes`, because there is no native one:
   `AWS::SNS::Topic.DeliveryStatusLogging` covers only the http/sqs/lambda/firehose/application
   protocols and is scoped to a topic, while a direct-to-phone `Publish` uses no topic. Nothing to
   run by hand. To log only failures — the cheaper posture once volume matters — change
   `DeliveryStatusSuccessSamplingRate` to `"0"` in the stack and redeploy.

2. **Point the app at the topic.** Set `SMS_SNS_TOPIC_ARN` from the `SmsDeliveryReceiptsTopicArn`
   output. Unset, `/api/webhooks/sms` answers 503 and sending is unaffected.

3. **Subscribe the endpoint** — nothing to run. Every `pnpm infra:deploy` subscribes both
   `/api/webhooks/sms` and `/api/webhooks/ses`
   ([20260803-webhook-subscriptions-in-cdk](../architecture/decisions/20260803-webhook-subscriptions-in-cdk.md)).
   The route answers SNS's `SubscriptionConfirmation` handshake automatically, re-validating the
   `SubscribeURL` host before fetching it.

   The one catch: it can only confirm once step 2 is live, since `/api/webhooks/sms` answers 503
   without `SMS_SNS_TOPIC_ARN`. On a fresh environment, verify the subscription confirmed rather
   than assuming — `aws sns list-subscriptions-by-topic --topic-arn <SmsDeliveryReceiptsTopicArn>`,
   and see [§9 of the infrastructure runbook](infrastructure-runbook.md#9-webhook-subscriptions) if
   it reads `PendingConfirmation`.

## What lands where

| SNS status | Recorded as | Detail kept |
| --- | --- | --- |
| `SUCCESS` | `delivered` | none — the success `providerResponse` is boilerplate |
| `FAILURE` | `failed` | the carrier's `providerResponse`, verbatim |
| anything else | ignored, answered 200 | — |

`SUCCESS` maps to **delivered**, not sent: SNS reports it on carrier confirmation of handset
delivery, which is what `delivered` means for every other provider on the delivery row.

## Most receipts match nothing, and that is correct

A courtesy text sent *alongside* an email is not the tracked channel and has no delivery row of its
own — only a **phone-only diver's** SMS does. So `sms_webhook.delivery_applied` will log
`unknown_message` for the majority of receipts. That is the shape of the data, not a fault; the same
is true of the SES and WhatsApp routes.

## When receipts stop arriving

Work the pipeline backwards — each hop has its own failure mode:

- **`/api/webhooks/sms` answering 503** — `SMS_SNS_TOPIC_ARN` is unset.
- **Answering 400** — the message failed SNS signature verification, or arrived for a different
  topic ARN than the one configured.
- **Nothing arriving at all** — check the SNS subscription is *confirmed* (a pending subscription
  silently delivers nothing), then the forwarder Lambda's own CloudWatch logs, then that the
  `SnsSmsDeliveryStatusAttributes` custom resource actually applied (`aws sns get-sms-attributes`
  should show the role ARN). Without delivery-status logging SNS writes no receipts at all, so every
  downstream hop is idle and healthy-looking — which is why it is set by the stack rather than by
  hand.
- **Receipts arriving but no row updating** — expected for email-tracked bookings (see above). If it
  is happening for a phone-only diver, compare the receipt's `notification.messageId` against the
  delivery row's `provider_message_id`; they should be the same value SNS `Publish` returned.

## Retention

Both log groups keep two weeks. These records contain diver phone numbers and the only part DiveDay
needs is copied onto the delivery row within seconds, so the raw receipts are a liability rather than
an asset after that.

The forwarder's own logs go to `/diveday/lambda/sms-receipt-forwarder` (one month), declared by the
stack and named on the function's logging config. **Not** `/aws/lambda/diveday-sms-receipt-forwarder`:
that is the group Lambda creates by itself on a function's first run, and the function had already run
before the stack declared a group for it, so a stack naming exactly that group failed change-set
validation with "already exists" (2026-09-02). The auto-created group is orphaned rather than adopted.
It has no retention and nothing writes to it any more, so delete it once:

```bash
aws logs delete-log-group --log-group-name /aws/lambda/diveday-sms-receipt-forwarder
```

`infra/lib/sms-receipt-forwarder.test.ts` pins the declared name so a tidy-minded rename cannot bring
the collision back.

## STOP, HELP and START

Replies to DiveDay's texting number come down the same topic and the same route as the receipts
(ADR [20261007-sms-stop-and-help](../architecture/decisions/20261007-sms-stop-and-help.md)). The
number's two-way setting forwards every inbound text to `diveday-sms-delivery-receipts` through the
`diveday-sms-two-way` role; manual action `sns-sms-account-limits` sets it.

| The diver sends | AWS replies (keyword on the number) | The app |
| --- | --- | --- |
| `HELP` | the HELP message | nothing |
| `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `OPTOUT`, `REVOKE` | the STOP message, and adds the number to its own opt-out list | adds the number to `sms_opt_outs` |
| `START`, `UNSTOP` | AWS's opt-in confirmation | removes the number from `sms_opt_outs` |
| anything else | nothing | nothing |

The word has to be the whole reply ("Stop by the shop at 7?" changes nothing). A number on the
list is refused at send time with code `opted_out`, so a phone-only diver's delivery row says why no
text went. The route logs `sms_webhook.reply_applied` with the kind and never the number.

If a STOP is not reaching the list: confirm the number's two-way setting names the topic and role
(`aws pinpoint-sms-voice-v2 describe-phone-numbers`), then the subscription, as for receipts.

## Registering the number

Toll-free verification asks for the fields below. Fill in the brackets and paste each one as it
stands.

Use case description:

> DiveDay is booking and operations software for recreational scuba dive shops. Divers book a boat trip or course with a dive shop on the shop's DiveDay booking page. DiveDay sends text messages only about a booking the diver made: a reminder a week before and the day before the trip with the departure time and anything the diver still needs to finish, a link to sign the shop's dive waiver, and a link to the trip recap afterward. Every message names the dive shop and ends with how to opt out. DiveDay does not send marketing or promotional messages and does not share or sell phone numbers.

Opt-in workflow:

> A diver opts in on the dive shop's DiveDay booking page, for example [booking page URL]. The mobile number field is optional. Directly under it the form says: "By giving a mobile number, you agree to texts from DiveDay about your bookings: reminders, waiver links and trip recaps, up to four per booking. Message and data rates may apply. Reply STOP to opt out, HELP for help. Privacy policy" (linked to https://dive.day/privacy). Divers who leave the field blank are never texted. The same line sits under the phone field on the shop's self-registration and seat-claim pages. Screenshot attached.

Sample messages:

> Blue Reef Divers: Morning two-tank sails tomorrow (Oct 12, 7:30 – 11:30 AM EDT). Please be at the dock 30 min early. Questions? Text us at +1 305 555 0134. Reply STOP to opt out.

> Blue Reef Divers: please sign your dive release for Morning two-tank — https://dive.day/waivers/[token] Reply STOP to opt out.

> Blue Reef Divers: thanks for diving Morning two-tank! Your recap: https://dive.day/recap/[token] Reply STOP to opt out.

Message type: transactional. Use case: account notifications. Privacy policy: https://dive.day/privacy. Terms: https://dive.day/terms.
