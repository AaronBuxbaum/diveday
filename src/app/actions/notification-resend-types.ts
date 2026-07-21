/**
 * State for the one-tap "resend confirmation" control on the Today queue. Kept
 * out of the `"use server"` action file, which may only export async functions.
 */
export type ResendState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; reason: "invalid" | "no_email" | "not_configured" | "failed" };

export const IDLE_RESEND_STATE: ResendState = { status: "idle" };
