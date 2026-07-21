"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { retryBookingConfirmation } from "@/db/notifications";
import { requireStaffSession } from "@/lib/session";
import type { ResendState } from "./notification-resend-types";

/**
 * One-tap re-send of a failed booking confirmation from the Today queue, so an
 * email-delivery row is a fix, not just a link to the trip. Only confirmations
 * are retried here: a waiver link's one-time token is never stored, so re-sending
 * a waiver issues a fresh link through the shared WP-1 path instead.
 *
 * Auth and shop ownership are re-checked server-side; the caller only supplies a
 * booking id. Degrades to a plain form post without JavaScript.
 */
export async function resendConfirmationAction(
  shopSlug: string,
  _prev: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return { status: "error", reason: "invalid" };

  const delivery = await retryBookingConfirmation(await getDb(), session.user.shopId, bookingId);
  // Refresh Today so a now-delivered confirmation drops off the queue.
  revalidatePath(`/shop/${shopSlug}`);

  if (!delivery) return { status: "error", reason: "no_email" };
  if (delivery.status === "sent") return { status: "sent" };
  return {
    status: "error",
    reason: delivery.status === "not_configured" ? "not_configured" : "failed",
  };
}
