"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { type BookingOutcome, createBooking } from "@/db/bookings";
import { getDb } from "@/db/client";
import { recordTripActivity } from "@/db/operations";
import { issueWaiverOnJoin } from "@/db/waiver-issue";
import { trackEvent } from "@/lib/analytics";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

const checkInPath = (shopSlug: string) => `/shop/${shopSlug}/check-in`;

/**
 * Maps a booking-creation refusal to a check-in notice code. The rarer
 * course-specific gates (prerequisite, ratio, unstaffed, minimum age) collapse
 * into one honest "not available for a walk-in" message rather than a
 * five-way branch nobody at the counter needs to distinguish — the trip page
 * still has the specific reason for whoever investigates.
 */
function walkInNotice(reason: Exclude<BookingOutcome, { ok: true }>["reason"]): string {
  switch (reason) {
    case "trip_full":
      return "walkin_full";
    case "already_booked":
      return "walkin_already";
    default:
      return "walkin_unavailable";
  }
}

const walkInDiverSchema = z.object({
  tripId: z.uuid(),
  fullName: z.string().trim().min(1).max(120),
  // Optional at the counter — the crew can collect it later (task: fast
  // walk-in flow). `createBooking` (src/db/bookings.ts) treats a missing
  // email the same way `createDiver` already does: a fresh person row with
  // nothing to dedup against, never a required field.
  email: z.union([z.literal(""), z.email().max(200)]).optional(),
  phone: z.string().trim().max(30).optional(),
});

const walkInExistingSchema = z.object({
  tripId: z.uuid(),
  personId: z.uuid(),
});

async function afterBooking(
  shopSlug: string,
  shopId: string,
  actorPersonId: string,
  outcome: BookingOutcome & { ok: true },
  tripId: string,
) {
  await trackEvent({ name: "booking_completed", source: "staff", partySize: 1 });
  await recordTripActivity(await getDb(), {
    shopId,
    tripId,
    actorPersonId,
    action: `added ${outcome.personName} to the trip as a walk-in`,
  });
  // A walk-in gets their waiver right away too, when the trip needs one and
  // they aren't already covered. Best-effort: a delivery failure never
  // undoes the add — matching addBookingAction (trips/[id]/actions.ts).
  try {
    await issueWaiverOnJoin(await getDb(), shopId, outcome.bookingId);
  } catch {
    console.error("Waiver-on-join could not be issued", { bookingId: outcome.bookingId });
  }
  revalidateAndRedirect(
    checkInPath(shopSlug),
    `${checkInPath(shopSlug)}?notice=walkin_added&bid=${outcome.bookingId}`,
  );
}

/** New diver, hand-entered at the counter — name only is enough to get them on the boat. */
export async function addWalkInBookingAction(shopSlug: string, formData: FormData) {
  const s = await requireStaffSession();
  const parsed = walkInDiverSchema.safeParse({
    tripId: formData.get("tripId"),
    fullName: formData.get("fullName"),
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) redirect(`${checkInPath(shopSlug)}?notice=walkin_invalid`);
  const { tripId, fullName, phone } = parsed.data;
  const email = parsed.data.email || undefined;
  const outcome = await createBooking(await getDb(), {
    actor: "staff",
    shopId: s.user.shopId,
    tripId,
    fullName,
    email,
    phone,
  });
  if (!outcome.ok) {
    await trackEvent({ name: "booking_blocked", source: "staff", reason: outcome.reason });
    redirect(`${checkInPath(shopSlug)}?notice=${walkInNotice(outcome.reason)}`);
  }
  await afterBooking(shopSlug, s.user.shopId, s.user.personId, outcome, tripId);
}

/** A returning diver, picked by identity — "enter once, reuse everywhere." */
export async function addExistingWalkInAction(shopSlug: string, formData: FormData) {
  const s = await requireStaffSession();
  const parsed = walkInExistingSchema.safeParse({
    tripId: formData.get("tripId"),
    personId: formData.get("personId"),
  });
  if (!parsed.success) redirect(`${checkInPath(shopSlug)}?notice=walkin_invalid`);
  const { tripId, personId } = parsed.data;
  const outcome = await createBooking(await getDb(), {
    actor: "staff",
    shopId: s.user.shopId,
    tripId,
    personId,
  });
  if (!outcome.ok) {
    await trackEvent({ name: "booking_blocked", source: "staff", reason: outcome.reason });
    redirect(`${checkInPath(shopSlug)}?notice=${walkInNotice(outcome.reason)}`);
  }
  await afterBooking(shopSlug, s.user.shopId, s.user.personId, outcome, tripId);
}
