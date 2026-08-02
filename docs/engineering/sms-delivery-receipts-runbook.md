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

3. **Subscribe the endpoint.** Add an HTTPS subscription on `diveday-sms-delivery-receipts` pointing
   at `https://<app-host>/api/webhooks/sms`. The route answers SNS's `SubscriptionConfirmation`
   handshake automatically — it re-validates the `SubscribeURL` host before fetching it.

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
is true of the Resend and WhatsApp routes.

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
