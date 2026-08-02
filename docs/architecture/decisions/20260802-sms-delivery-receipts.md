# 20260802-sms-delivery-receipts — Route SNS SMS delivery receipts through CloudWatch, a forwarder, and an SNS topic

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

Email and WhatsApp both know what happened to a message after it was accepted.
[20260718-notification-delivery-status](20260718-notification-delivery-status.md) established the
shape — a provider event applied to the `notification_deliveries` row by provider message id — and
`/api/webhooks/resend`, `/api/webhooks/ses`, and now `/api/webhooks/whatsapp` all feed it.

SMS is the hole. [20260802-whatsapp-embedded-signup](20260802-whatsapp-embedded-signup.md) closed with
the observation that SNS "doesn't send delivery webhooks for direct-to-phone publishes at all" and
deferred the work. That matters most for the divers it covers: a courtesy text sent alongside an
email is untracked by design, but a **phone-only diver's SMS is the tracked channel**, so today the
delivery row for those bookings freezes at whatever the send call returned and never learns that the
handset never got it.

The obstacle is real and worth stating precisely, because it is why this is a pipeline rather than a
route. For a direct-to-phone `Publish`, SNS writes a delivery receipt to **CloudWatch Logs** —
`sns/<region>/<account>/DirectPublishToPhoneNumber`, plus a `/Failure` sibling — and to nowhere else.
There is no event destination, no topic, no callback. And a CloudWatch subscription filter can only
target Lambda, Kinesis, or Firehose; it cannot target SNS. So something has to carry the record.

## Decision

- **Logs → subscription filter → forwarder Lambda → SNS topic → `/api/webhooks/sms`.** Four hops,
  each because the previous one has no shorter path to the next.

- **The extra SNS hop is the point, not overhead.** The forwarder could POST to DiveDay directly, and
  that would be one fewer resource — but it would also be a *fourth* inbound authentication scheme
  (after Svix for Resend, SNS signatures for SES, and HMAC for Meta), invented for one caller. Going
  through a topic means the receipt arrives inside the same signed SNS envelope `/api/webhooks/ses`
  already verifies, so the route reuses `verifySnsMessage`, `confirmSnsSubscription`, and
  `readWebhookPayload` unchanged and the app gains no new trust boundary.

- **The forwarder republishes each log record verbatim.** It gunzips the CloudWatch batch, skips
  `CONTROL_MESSAGE`, and publishes each `logEvents[].message` as its own SNS message. It parses
  nothing and reshapes nothing, so `src/lib/notifications/sms-events.ts` sees exactly the bytes
  CloudWatch wrote and there is one place — in the app, under test — where the receipt's meaning is
  decided.

- **`SUCCESS` maps to `delivered`, not `sent`.** SNS reports success on carrier confirmation of
  handset delivery, which is what `delivered` means for every other provider in this table. Mapping
  it to `sent` would understate what is known and leave every SMS looking permanently in flight on
  the staff dashboard.

- **Only a failure keeps `providerResponse`.** On a success it reads "Message has been accepted by
  phone", which is noise next to a status that already says delivered.

- **Log retention is bounded to two weeks.** These records name a diver's phone number, and the only
  part DiveDay needs is copied onto the delivery row within seconds. Keeping the raw receipts
  indefinitely — the CloudWatch default — is a liability with no matching benefit.

- **Switching delivery-status logging on stays a documented CLI step.** It is set by
  `sns set-sms-attributes`, which is account-level state with no CloudFormation resource. The CDK
  stack creates the IAM role SNS needs and emits the exact command as an output; the runbook carries
  it. Inventing a custom resource to wrap one idempotent API call is more moving parts than the call.

## Alternatives considered

- **Move sending to AWS End User Messaging (ex-Pinpoint SMS).** It publishes delivery events to an
  SNS topic or Kinesis natively, which would delete the Lambda, the subscription filter, and both log
  groups from this design. Genuinely the cleaner destination, and worth revisiting. Rejected for now
  because it replaces the send path too — a different API, different credentials, different IAM, and
  a re-run of the phone-number provisioning that [20260802-sns-sms-adapter](20260802-sns-sms-adapter.md)
  chose SNS to avoid. Trading a working sender for a tidier receipt path is the wrong order to do
  these in; if the sender moves for its own reasons, this pipeline is what gets deleted.

- **Have the forwarder POST straight to `/api/webhooks/sms` with a shared secret.** Fewer resources,
  but a bespoke auth scheme for one caller — see above. The topic costs almost nothing and reuses
  verification that already exists and is already tested.

- **Poll CloudWatch Logs from the app on a schedule.** No Lambda, no topic, no inbound endpoint. But
  it inverts the direction of every other provider integration here, needs its own cursor state to
  avoid re-reading, and gives receipts a latency floor set by the poll interval. Push is what the
  rest of this subsystem does.

- **Skip receipts and treat the send result as final.** The status quo. Rejected because it is
  precisely wrong for the case that matters most: a phone-only diver has no email fallback, so an SMS
  that silently failed is a diver who will not be on the boat and a shop with no signal that anything
  went wrong.

## Consequences

- **First Lambda in the stack.** `infra/` has been IAM, S3, SES, SNS, and budgets so far; this adds a
  runtime to keep alive. It is inline, dependency-free beyond the SDK the runtime ships, and does one
  thing, but it is a new class of thing to operate.
- **The channel stays dormant until `SMS_SNS_TOPIC_ARN` is set and the endpoint is subscribed**, and
  independently until `set-sms-attributes` is run. Unset, the route answers 503 and sending is
  unaffected — the same posture as every other provider here.
- **Most receipts will find no row to update**, because a courtesy text riding alongside an email is
  not the tracked channel. That is `unknown_message`, logged and answered 200, exactly as the Resend
  and WhatsApp routes already treat it — not an error, just the shape of the data.
- **Untested against real AWS.** The parser and the route are unit-tested, and the stack synthesizes,
  but nothing here has been deployed: the forwarder's decoding of a real CloudWatch batch and the
  end-to-end subscription are unverified. Expect one round of fixes on first deploy.
- **Delivery-status logging costs money at 100% sampling** — a CloudWatch log line per message. The
  runbook notes setting the success sample rate to 0 to log only failures if the volume ever matters.
