import { getDb } from "@/db/client";
import { recordInboundEmail, routeInboundEmail } from "@/db/inbound-emails";
import { applyProviderEmailEvent } from "@/db/notifications";
import { nowDate } from "@/lib/clock";
import { parseResendEmailEvent } from "@/lib/notifications/events";
import { inboundEmailFetcherFromEnvironment } from "@/lib/notifications/inbound";
import { verifyResendWebhook } from "@/lib/notifications/webhook";

export const runtime = "nodejs";

/**
 * The single Resend webhook endpoint, carrying two conversations at once:
 * what happened to mail we sent (delivered, bounced, marked as spam), and mail
 * a diver sent back (docs ADR 20260724-resend-webhook-email-events). Fails
 * closed on a bad, stale, or missing signature before any event is handled.
 *
 * Answers 200 for anything it has verified but does not act on. Resend retries
 * a non-2xx, so returning an error for an event type we simply don't handle —
 * or for a message id we never tracked — would buy an endless redelivery loop
 * and nothing else.
 */
export async function POST(request: Request) {
  const payload = await request.text();
  const verification = verifyResendWebhook(
    payload,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    process.env.RESEND_WEBHOOK_SECRET,
  );

  if (verification.status === "not_configured") return new Response(null, { status: 503 });
  if (verification.status !== "verified") return new Response(null, { status: 400 });

  const now = nowDate();
  const event = parseResendEmailEvent(verification.event, now);
  if (event.kind === "ignored") return new Response(null, { status: 200 });

  const db = await getDb();

  if (event.kind === "delivery") {
    await applyProviderEmailEvent(db, {
      providerMessageId: event.providerMessageId,
      status: event.status,
      detail: event.detail,
      occurredAt: event.occurredAt,
    });
    return new Response(null, { status: 200 });
  }

  const routing = await routeInboundEmail(db, event.recipients);
  // Body fetch is best-effort: `email.received` carries metadata only, and a
  // message we can see arrived is worth filing even when its text never
  // comes back.
  const fetcher = inboundEmailFetcherFromEnvironment();
  const body = fetcher ? await fetcher.fetchBody(event.providerEmailId) : null;

  await recordInboundEmail(db, {
    ...routing,
    providerEmailId: event.providerEmailId,
    from: event.from,
    recipients: event.recipients,
    subject: event.subject,
    textBody: body?.text ?? "",
    hasAttachments: event.hasAttachments,
    receivedAt: event.receivedAt,
  });
  return new Response(null, { status: 200 });
}
