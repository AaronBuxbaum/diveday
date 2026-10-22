import type { NotificationDelivery } from "./notifications/provider";

/** Durable best-effort receipt state; terminal states are never reclaimed. */
export const SETUP_RECEIPT_STATES = [
  "pending",
  "claimed",
  "accepted",
  "failed",
  "unknown",
  "suppressed",
] as const;
export type SetupReceiptStatus = (typeof SETUP_RECEIPT_STATES)[number];
/** These fixed codes are the only failure detail stored or logged for a receipt. */
export const SETUP_RECEIPT_ERRORS = [
  "address_cooldown",
  "global_limit",
  "not_configured",
  "invalid_test_recipient",
  "throttled",
  "rejected",
  "provider_rejected",
  "provider_unavailable",
  "network_error",
  "invalid_response",
  "send_exception",
] as const;
export type SetupReceiptError = (typeof SETUP_RECEIPT_ERRORS)[number];
export type SetupReceiptOutcome =
  | { status: "accepted"; providerMessageId: string }
  | { status: "failed" | "unknown"; errorCode: SetupReceiptError };

/** SES acceptance is not delivery; an ambiguous result is never retried. */
export function setupReceiptOutcome(delivery: NotificationDelivery): SetupReceiptOutcome {
  if (delivery.status === "sent") {
    return /^[A-Za-z0-9_-]{1,256}$/.test(delivery.providerMessageId)
      ? { status: "accepted", providerMessageId: delivery.providerMessageId }
      : { status: "unknown", errorCode: "invalid_response" };
  }
  if (delivery.status === "not_configured")
    return { status: "failed", errorCode: "not_configured" };
  switch (delivery.errorCode) {
    case "invalid_test_recipient":
    case "not_configured":
      return { status: "failed", errorCode: delivery.errorCode };
    case "TooManyRequestsException":
    case "throttled":
      return { status: "failed", errorCode: "throttled" };
    case "MessageRejected":
    case "rejected":
      return { status: "failed", errorCode: "rejected" };
    case "network_error":
    case "invalid_response":
    case "provider_unavailable":
    case "send_exception":
      return { status: "unknown", errorCode: delivery.errorCode };
  }
  if (delivery.httpStatus === 429) return { status: "failed", errorCode: "throttled" };
  if (delivery.retryable || (delivery.httpStatus !== undefined && delivery.httpStatus >= 500)) {
    return { status: "unknown", errorCode: "provider_unavailable" };
  }
  return { status: "failed", errorCode: "provider_rejected" };
}
