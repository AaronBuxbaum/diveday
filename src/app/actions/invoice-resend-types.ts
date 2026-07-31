/**
 * State for the Today queue's one-tap "resend invoice" control. Kept out of
 * the `"use server"` action file (a `"use server"` module may only export
 * async functions) — same split as `./notification-resend-types.ts`.
 */
export type InvoiceResendState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; reason: "not_found" | "not_open" | "not_configured" | "failed" };

export const IDLE_INVOICE_RESEND_STATE: InvoiceResendState = { status: "idle" };
