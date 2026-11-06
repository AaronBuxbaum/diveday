"use server";

import { redirect } from "next/navigation";
import { openYourDay } from "@/db/your-days";
import { isUuid } from "@/lib/uuid";
import { contextFor } from "./action-helpers";

/** What one row answers when it cannot open: the row it was, and a code the row words. */
export type YourDayLinkState = {
  bookingId: string | null;
  outcome: "unavailable" | "rate_limited" | null;
};

/**
 * **Open one of the diver's other days** (#4059; ADR
 * 20261016-fresh-link-per-booking-row).
 *
 * Authorized like every action on this page: the verified readiness token
 * names one booking, and `openYourDay` accepts a target only from that
 * booking's own list (same shop, same person). Success redirects to that
 * day's own page.
 */
export async function openYourDayAction(
  token: string,
  _previous: YourDayLinkState,
  formData: FormData,
): Promise<YourDayLinkState> {
  const raw = formData.get("bookingId");
  const targetBookingId = typeof raw === "string" && isUuid(raw) ? raw : null;
  if (!targetBookingId) return { bookingId: null, outcome: "unavailable" };

  const context = await contextFor(token);
  if (!context.ok) {
    return {
      bookingId: targetBookingId,
      outcome: context.reason === "rate_limited" ? "rate_limited" : "unavailable",
    };
  }
  // A held seat's link holder may not be the person the seat was matched to
  // (#2082), and the link a booking or a claim redirects to proves only a
  // typed name and address (security review r5-4, F1): neither reaches that
  // person's other days. The page draws no row for either; this is a hand-made post.
  if (context.data.identityHeld || !context.delivered) {
    return { bookingId: targetBookingId, outcome: "unavailable" };
  }

  const path = await openYourDay(context.db, {
    shopId: context.data.shop.id,
    fromBookingId: context.bookingId,
    targetBookingId,
  });
  if (!path) return { bookingId: targetBookingId, outcome: "unavailable" };
  redirect(path);
}
