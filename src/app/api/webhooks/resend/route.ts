import { getDb } from "@/db/client";
import { applyProviderEmailEvent } from "@/db/notifications";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { parseResendEmailEvent } from "@/lib/notifications/events";
import { verifyResendWebhook } from "@/lib/notifications/webhook";

/**
 * The Resend webhook: what happened to mail we sent — delivered, bounced,
 * marked as spam (docs ADR 20260726-hosted-mailboxes-for-platform-mail). Fails
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

  const event = parseResendEmailEvent(verification.event, nowDate());
  if (event.kind === "ignored") return new Response(null, { status: 200 });

  const result = await applyProviderEmailEvent(await getDb(), {
    providerMessageId: event.providerMessageId,
    status: event.status,
    detail: event.detail,
    occurredAt: event.occurredAt,
  });
  // The only observability on this path: applied/stale/unknown_message, none
  // of which is an error response (Resend retries a non-2xx, and a message id
  // we never tracked or a delivery already superseded is not a fault of this
  // endpoint) but every one of which is worth a trace (docs product/
  // archive/specialist-optimization-audit-20260731.md §7).
  log("resend_webhook.delivery_applied", result === "applied" ? "info" : "warn", {
    providerMessageId: event.providerMessageId,
    status: event.status,
    result,
  });
  return new Response(null, { status: 200 });
}
