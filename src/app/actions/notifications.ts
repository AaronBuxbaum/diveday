"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { listNotificationDeliveryIssues } from "@/db/notifications";
import { resendConfirmationWithWaiver } from "@/db/waiver-issue";
import { trackEvent } from "@/lib/analytics";
import { nowDate } from "@/lib/clock";
import { operationalWindow } from "@/lib/operational-window";
import { requireShopSurface } from "@/lib/session";
import type { ResendState } from "./notification-resend-types";

/**
 * One-tap re-send of a failed booking confirmation from the Today queue, so an
 * email-delivery row is a fix, not just a link to the trip. Only confirmations
 * are retried here, and when a waiver is still owed the booking's live link
 * rides in the mail as its first step (issue #2473).
 *
 * Auth and shop ownership are re-checked server-side; the caller only supplies
 * booking ids. A batched row posts several, so the set is **re-derived on the
 * server**: only a booking whose confirmation is on the Today queue's own list
 * of failed deliveries is retried, and a post naming more than
 * `MAX_BATCH_RESEND` is refused whole. A forged or stale id is a no-op rather
 * than an email to whoever it names (`security-reviewer`, 2026-10-05). Falls
 * back to a plain form post before hydration.
 */
const MAX_BATCH_RESEND = 50;

export async function resendConfirmationAction(
  shopSlug: string,
  _prev: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const session = (await requireShopSurface(shopSlug)).session;
  // One booking, or every one a batched Today row stands for. Each retry is
  // scoped to the session's shop by `resendConfirmationWithWaiver` itself.
  const bookingIds = [
    ...new Set(
      formData
        .getAll("bookingId")
        .map((value) => String(value))
        .filter(Boolean),
    ),
  ];
  if (bookingIds.length === 0 || bookingIds.length > MAX_BATCH_RESEND) {
    return { status: "error", reason: "invalid" };
  }

  const db = await getDb();
  const { from, to } = operationalWindow(nowDate());
  const failed = new Set(
    (await listNotificationDeliveryIssues(db, session.user.shopId, { from, until: to }))
      .filter((issue) => issue.delivery.kind === "booking_confirmation")
      .map((issue) => issue.booking.id),
  );
  const retryable = bookingIds.filter((id) => failed.has(id));
  if (retryable.length === 0) return { status: "error", reason: "invalid" };

  let failure: Exclude<ResendState, { status: "idle" } | { status: "sent" }> | null = null;
  for (const bookingId of retryable) {
    const delivery = await resendConfirmationWithWaiver(db, session.user.shopId, bookingId);
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
