"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { retryBookingConfirmation } from "@/db/notifications";
import { trackEvent } from "@/lib/analytics";
import { requireStaffSession } from "@/lib/session";
import type { ResendState } from "./notification-resend-types";

/**
 * One-tap re-send of a failed booking confirmation from the Today queue, so an
 * email-delivery row is a fix, not just a link to the trip. Only confirmations
 * are retried here: a waiver link's one-time token is never stored, so re-sending
 * a waiver issues a fresh link through the shared WP-1 path instead.
 *
 * Auth and shop ownership are re-checked server-side; the caller only supplies a
 * booking id. Falls back to a plain form post before hydration.
 */
export async function resendConfirmationAction(
  shopSlug: string,
  _prev: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const session = await requireStaffSession();
  // One booking, or every one a batched Today row stands for. Each retry is
  // scoped to the session's shop by `retryBookingConfirmation` itself.
  const bookingIds = [
    ...new Set(
      formData
        .getAll("bookingId")
        .map((value) => String(value))
        .filter(Boolean),
    ),
  ];
  if (bookingIds.length === 0) return { status: "error", reason: "invalid" };

  const db = await getDb();
  let failure: Exclude<ResendState, { status: "idle" } | { status: "sent" }> | null = null;
  for (const bookingId of bookingIds) {
    const delivery = await retryBookingConfirmation(db, session.user.shopId, bookingId);
    if (delivery?.status === "sent") {
      await trackEvent({ name: "staff_recovery", kind: "confirmation_resent", surface: "today" });
      continue;
    }
    failure ??= {
      status: "error",
      reason: !delivery
        ? "no_email"
        : delivery.status === "not_configured"
          ? "not_configured"
          : "failed",
    };
  }
  // Refresh Today so a now-delivered confirmation drops off the queue.
  revalidatePath(`/shop/${shopSlug}`);

  return failure ?? { status: "sent" };
}
