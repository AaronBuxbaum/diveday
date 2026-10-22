/** Email delivery handles and fixed setup-receipt states, classified for the erasure coverage net. */
export const notificationProcessorColumns = {
  "notification_deliveries.provider_message_id": {
    held: "elsewhere",
    why: "SES's, SNS's or Meta's handle on a message that carried this diver's name. The erasure clears the prose beside it (`provider_detail`, `send_error`) and keeps the handle as the shop's evidence that a message went. A `wamid.` embeds the recipient's number, so it is rewritten to `wamid.` plus its SHA-256. Nothing is owed against the provider's copy: Meta keeps a Cloud API message at most 30 days, and SES and SNS keep no copy a shop can reach (ADR)",
  },
  "notification_delivery_attempts.provider_message_id": { held: "elsewhere", why: "as above" },
  "notification_send_queue.provider_message_id": {
    held: "elsewhere",
    why: "the same handle on a send that was still queued. The row itself is deleted by the address and number sweeps, so this one usually goes with it",
  },
  "setup_requests.receipt_provider_message_id": {
    held: "elsewhere",
    why: "SES receipt handle for a platform setup request, erased with that request by email/phone erasure or retention; no reachable provider copy is promised",
  },
  "setup_requests.receipt_status": {
    held: "none",
    why: "fixed receipt lifecycle code, not an external identity; erased with its setup request",
  },
  "setup_requests.receipt_error_code": {
    held: "none",
    why: "bounded receipt error code without provider prose or personal data; erased with its setup request",
  },
} as const;
