import { recordBookkeeperDeliveryOutcome } from "@/db/bookkeeper";
import { getDb } from "@/db/client";
import { optOutAddressAfterComplaint } from "@/db/courtesy-email";
import { recordEmailBounces } from "@/db/email-bounces";
import { applyProviderEmailEvent } from "@/db/notifications";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  parseSesBookkeeperOutcomes,
  parseSesBounceReports,
  parseSesEmailEvent,
} from "@/lib/notifications/ses-events";
import { gateSnsWebhook } from "@/lib/notifications/sns-webhook";

/**
 * The SES delivery-outcome webhook (ADR 20260802-ses-adapter-and-webhook,
 * 20260803-ses-sole-email-provider). SES itself never calls this endpoint
 * directly — Amazon SNS does, carrying an SES event inside its own
 * `Notification` envelope. Fails closed on an unconfigured topic, an
 * untrusted certificate host, or a bad/mismatched signature before any event
 * is handled.
 *
 * Answers 200 for anything verified but not acted on: SNS retries a non-2xx,
 * so erroring on an event type this endpoint doesn't handle — or a message id
 * it never tracked — would buy an endless redelivery loop and nothing else.
 */
export async function POST(request: Request) {
  const gate = await gateSnsWebhook(request, process.env.SES_SNS_TOPIC_ARN, "ses");
  if (gate.kind === "response") return gate.response;
  const { message } = gate;

  const event = parseSesEmailEvent(message.Message, nowDate());
  if (event.kind === "ignored") return new Response(null, { status: 200 });

  const db = await getDb();
  const result = await applyProviderEmailEvent(db, {
    providerMessageId: event.providerMessageId,
    status: event.status,
    detail: event.detail,
    occurredAt: event.occurredAt,
  });
  log("ses_webhook.delivery_applied", result === "applied" ? "info" : "warn", {
    providerMessageId: event.providerMessageId,
    status: event.status,
    result,
  });

  // Every bounce and complaint is kept per address, tracked message or not,
  // so DiveDay can see which mail bounces, why, for which shop and who sent it
  // (`email_bounces`, read by the founder's digest). The log line carries the
  // classification and the recipient's domain, never the address.
  const reports = parseSesBounceReports(message.Message, nowDate());
  if (reports.length > 0) {
    const recorded = await recordEmailBounces(db, reports);
    for (const report of reports) {
      log("ses_webhook.bounce_recorded", "info", {
        providerMessageId: report.providerMessageId,
        verdict: report.event,
        bounceType: report.bounceType,
        bounceSubType: report.bounceSubType,
        smtpStatus: report.smtpStatus,
        complaintType: report.complaintType,
        kind: report.kind,
        purpose: report.purpose,
        shopId: report.shopId,
        sentByPersonId: report.sentByPersonId,
        recipientDomain: report.recipient.split("@").pop() ?? null,
        newRows: recorded,
      });
    }
  }

  // A complaint is an unsubscribe, whichever message it came in on — filed by
  // address within the shop the message tag names, so it lands even when the
  // message id was never tracked (the courtesy kinds record none). The line
  // carries counts and ids, never the address (PII-in-logs rule).
  //
  // `event.recipient` is the address SES sent to. For a demo shop's seeded
  // person that is the simulator address (`success+priya.sharma@...`), not
  // the `priya.sharma@mail.example` on `people.email`, so this lookup would
  // miss them. Deliberately not mapped back: the seed only ever sends to the
  // simulator's `success` outcome, which never produces a complaint, and a
  // real diver can type a simulator address too, so a reverse mapping would
  // file their complaint against someone else's row.
  if (event.status === "complained" && event.shopId && event.recipient) {
    const optedOut = await optOutAddressAfterComplaint(db, {
      shopId: event.shopId,
      email: event.recipient,
      now: event.occurredAt,
    });
    log("ses_webhook.complaint_opt_out", "info", {
      providerMessageId: event.providerMessageId,
      shopId: event.shopId,
      ...optedOut,
    });
  }
  // A month-end send to the bookkeeper that bounced, or was delivered after
  // one did (issue #2798). Matched by the message's shop tag and the address
  // on file; the line carries the shop and the outcome, never the address.
  for (const outcome of parseSesBookkeeperOutcomes(message.Message, nowDate())) {
    const result = await recordBookkeeperDeliveryOutcome(db, {
      shopId: outcome.shopId,
      recipient: outcome.recipient,
      outcome: outcome.outcome,
      at: outcome.occurredAt,
    });
    log("ses_webhook.bookkeeper_outcome", "info", {
      providerMessageId: event.providerMessageId,
      shopId: outcome.shopId,
      outcome: outcome.outcome,
      result,
    });
  }
  return new Response(null, { status: 200 });
}
