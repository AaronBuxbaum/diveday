"use server";

import { planYourDayLink, sendYourDayLink, type YourDayLinkOutcome } from "@/db/your-days";
import { log } from "@/lib/log";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { isUuid } from "@/lib/uuid";
import { contextFor } from "./action-helpers";

/** What one row's send answers: the row it was, and a code the row words. */
export type YourDayLinkState = {
  bookingId: string | null;
  outcome: YourDayLinkOutcome | "rate_limited" | null;
};

/**
 * **"Email me the link" on one of the diver's other days** (H-20261014-other-days-send-fresh, ADR
 * 20261016-fresh-link-per-booking-row).
 *
 * Authorized like every action on this page: the verified readiness token
 * names one booking, and `planYourDayLink` accepts a target only from that
 * booking's own list (same shop, same person). The link goes to the address on
 * file and only a code comes back, so nothing here opens another booking.
 *
 * Three budgets: the per-IP one inside `contextFor`, one per *target*
 * booking, and one per person, the last two spent only once the plan says a
 * send will happen, so a refused post costs the diver nothing.
 */
export async function sendYourDayLinkAction(
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

  const plan = await planYourDayLink(context.db, {
    shopId: context.data.shop.id,
    fromBookingId: context.bookingId,
    targetBookingId,
  });
  if (!plan.ok) return { bookingId: targetBookingId, outcome: plan.reason };

  const inboxKey = rateLimitKey("your-day-link", "booking", plan.bookingId);
  if (!(await checkRateLimit(inboxKey, RATE_LIMITS.readinessLinkResendByBooking)).allowed) {
    return { bookingId: targetBookingId, outcome: "rate_limited" };
  }
  // Every row mails the same person, so the person is a budget too (N1).
  const personKey = rateLimitKey("your-day-link", "person", context.data.person.id);
  if (!(await checkRateLimit(personKey, RATE_LIMITS.yourDayLinkByPerson)).allowed) {
    return { bookingId: targetBookingId, outcome: "rate_limited" };
  }

  try {
    return { bookingId: targetBookingId, outcome: await sendYourDayLink(context.db, plan) };
  } catch (error) {
    log("ready.your_day_link_failed", "error", {
      bookingId: plan.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    return { bookingId: targetBookingId, outcome: "failed" };
  }
}
