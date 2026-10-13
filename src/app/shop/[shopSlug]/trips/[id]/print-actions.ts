"use server";

import { getDb } from "@/db/client";
import { getTripWithBooked } from "@/db/trips";
import { trackEvent } from "@/lib/analytics";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

/**
 * Record the Trip surface's complete trip-packet action. The printable route
 * is opened by the browser in the same click, while this server action keeps
 * the event behind the same shop/session boundary as every other trip action.
 * It carries no trip id or diver data: the useful question is whether the
 * button is used, not which departure was printed.
 */
export async function recordTripPrintPdfAction(shopSlug: string, tripId: string) {
  if (!uuidParam(tripId)) return;
  const { session } = await requireShopSurface(shopSlug);
  const trip = await getTripWithBooked(await getDb(), session.user.shopId, tripId);
  if (!trip) return;
  await trackEvent({ name: "trip_print_pdf_clicked", surface: "trip_overview" });
}
