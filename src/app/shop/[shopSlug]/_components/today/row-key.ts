import type { TodayAction } from "@/lib/today";

/**
 * **The key a performing row keeps across its own fix landing.**
 *
 * `TodayAction.id` is `blocker:<booking>:<code>`, and the code is exactly what
 * a fix changes — a waiver goes from `waiver_missing` to `waiver_pending` the
 * moment it is sent. Keyed on the id, the row that was just tapped is a
 * *different* row to React, so its control unmounts and takes `useActionState`
 * with it: on a shop with no email configured that discards the private
 * fallback link the tap just produced, which is the one thing the staffer
 * needed. The row's own words still update — that part was never in doubt —
 * but the payload disappeared between the tap and the render.
 *
 * So a row that *performs* is keyed on what it performs against, which does
 * not change when the fix lands. A row that merely navigates holds no state
 * and keeps the id.
 */
export function rowKey(action: TodayAction): string {
  if (action.waiver) return `waiver:${action.waiver.bookingIds.join(",")}`;
  if (action.resend) return `resend:${action.resend.bookingIds.join(",")}`;
  if (action.invite) return `invite:${action.invite.leadId}`;
  if (action.payment?.orderId) return `payment:${action.payment.orderId}`;
  if (action.helpRequest) return `help-request:${action.helpRequest.requestId}`;
  return action.id;
}
