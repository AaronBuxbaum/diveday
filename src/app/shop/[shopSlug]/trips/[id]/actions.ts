"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { cancelBooking, getBookingForTrip, restoreBooking } from "@/db/bookings";
import { getDb } from "@/db/client";
import { assignGear, assignRecommendedGear, returnGear } from "@/db/gear";
import { sendAndRecordNotification } from "@/db/notifications";
import { setBookingPayment } from "@/db/payments";
import { upsertTripRequirements } from "@/db/readiness";
import { getShopById } from "@/db/shops";
import {
  getTripWithBooked,
  setTripCrew,
  setTripStatus,
  updateTrip,
  updateTripConditions,
} from "@/db/trips";
import { issueWaiverRequest } from "@/db/waivers";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { requireStaffSession } from "@/lib/session";
import { tripDiveDraftsFromForm } from "@/lib/trip-dives";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

const detailsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  capacity: z.coerce.number().int().min(1).max(60),
  plannedDives: z.coerce.number().int().min(1).max(4),
  priceDollars: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().nonnegative().finite().optional(),
  ),
});

const conditionsSchema = z.object({
  conditionsSummary: z.string().trim().max(600),
  waterTemperatureC: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(-2).max(40).optional(),
  ),
  visibilityMeters: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(0).max(100).optional(),
  ),
  surfaceConditions: z.string().trim().max(300),
});

const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit"]);
const paymentStatusSchema = z.enum(["unpaid", "deposit_paid", "paid", "waived", "refunded"]);
const requirementsSchema = z.object({
  requiresWaiver: z.string().optional(),
  minimumCertificationLevel: z.preprocess(
    (value) => (value === "" ? null : value),
    z.enum(["open_water", "advanced_open_water", "rescue", "divemaster", "instructor"]).nullable(),
  ),
});

const gearAssignmentSchema = z.object({
  bookingId: z.string().uuid(),
  gearItemId: z.string().uuid(),
});

const backPath = (shopSlug: string, tripId: string) => `/shop/${shopSlug}/trips/${tripId}`;

export async function saveDetails(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?notice=invalid`);
  const { title, description, date, startTime, endTime, capacity, plannedDives, priceDollars } =
    parsed.data;
  const sw = parseWallTime(date, startTime);
  const ew = parseWallTime(date, endTime);
  if (!sw || !ew) redirect(`${back}?notice=invalid`);
  const dbi = await getDb();
  const shopNow = await getShopById(dbi, s.user.shopId);
  if (!shopNow) redirect(`${back}?notice=invalid`);
  const startsAt = wallTimeToUtc(sw, shopNow.timezone);
  const endsAt = wallTimeToUtc(ew, shopNow.timezone);
  if (endsAt <= startsAt) redirect(`${back}?notice=end-before-start`);
  await updateTrip(dbi, s.user.shopId, tripId, {
    title,
    description: description || undefined,
    startsAt,
    endsAt,
    capacity,
    plannedDives,
    priceCents: priceDollars === undefined ? null : Math.round(priceDollars * 100),
    diveSiteId: tripDiveDraftsFromForm(formData, plannedDives)[0]?.diveSiteId ?? null,
    dives: tripDiveDraftsFromForm(formData, plannedDives),
  });
  revalidateAndRedirect(back, `${back}?notice=saved`);
}

export async function saveConditionsAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const parsed = conditionsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?notice=invalid`);
  const saved = await updateTripConditions(await getDb(), s.user.shopId, tripId, parsed.data);
  revalidateAndRedirect(back, `${back}?notice=${saved ? "conditions" : "invalid"}`);
}

export async function clearConditionsAction(shopSlug: string, tripId: string) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const saved = await updateTripConditions(await getDb(), s.user.shopId, tripId, {});
  revalidateAndRedirect(back, `${back}?notice=${saved ? "conditions-cleared" : "invalid"}`);
}

export async function cancelTripAction(shopSlug: string, tripId: string) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  await setTripStatus(await getDb(), s.user.shopId, tripId, "cancelled");
  revalidateAndRedirect(back, `${back}?notice=cancelled`);
}

export async function reinstateTripAction(shopSlug: string, tripId: string) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  await setTripStatus(await getDb(), s.user.shopId, tripId, "scheduled");
  revalidateAndRedirect(back, `${back}?notice=reinstated`);
}

export async function saveCrewAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const ids = formData.getAll("crew").map(String);
  await setTripCrew(await getDb(), s.user.shopId, tripId, ids);
  revalidateAndRedirect(back, `${back}?notice=crew`);
}

export async function removeBookingAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) redirect(back);
  await cancelBooking(await getDb(), s.user.shopId, bookingId);
  revalidateAndRedirect(back, `${back}?notice=booking-removed&bid=${bookingId}`);
}

export async function undoRemoveBookingAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  if (bookingId) await restoreBooking(await getDb(), s.user.shopId, bookingId);
  revalidateAndRedirect(back, `${back}?notice=booking-restored`);
}

export async function issueWaiverAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) redirect(`${back}?notice=waiver-error`);
  // Render-time snapshots threaded through hidden inputs, matching the former
  // closure over `shop` and the trip title.
  const shopName = String(formData.get("shopName") ?? "");
  const tripTitle = String(formData.get("tripTitle") ?? "");
  const timezone = String(formData.get("shopTimezone") ?? "");
  const db = await getDb();
  const outcome = await issueWaiverRequest(db, {
    shopId: s.user.shopId,
    bookingId,
  });
  if (!outcome.ok) {
    redirect(
      `${back}?notice=${outcome.reason === "already_completed" ? "waiver-complete" : "waiver-error"}`,
    );
  }
  const origin = publicAppUrl();
  if (origin) {
    const booking = await getBookingForTrip(db, tripId, bookingId);
    if (booking?.person.email) {
      try {
        const delivery = await sendAndRecordNotification(db, {
          kind: "waiver_request",
          waiverRecordId: outcome.recordId,
          bookingId,
          shopId: s.user.shopId,
          to: booking.person.email,
          diverName: booking.person.fullName,
          shopName,
          tripTitle,
          completionUrl: new URL(`/waivers/${outcome.token}`, `${origin}/`).toString(),
          expiresAt: outcome.expiresAt,
          timezone,
        });
        if (delivery.status === "failed") {
          console.error("Waiver request notification failed", {
            waiverRecordId: outcome.recordId,
          });
        }
      } catch {
        // Keep the staff-visible one-time link available if email delivery is unavailable.
        console.error("Waiver request notification could not be prepared", {
          waiverRecordId: outcome.recordId,
        });
      }
    }
  }
  revalidateAndRedirect(
    back,
    `${back}?notice=waiver-link&bid=${bookingId}&waiver=${outcome.token}`,
  );
}

export async function markPaymentAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const status = paymentStatusSchema.safeParse(formData.get("status"));
  const saved =
    bookingId && status.success
      ? await setBookingPayment(await getDb(), {
          shopId: s.user.shopId,
          bookingId,
          status: status.data,
        })
      : null;
  revalidateAndRedirect(back, `${back}?notice=${saved ? "payment" : "invalid"}`);
}

export async function saveRequirementsAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const db = await getDb();
  // Re-derive the course flag server-side rather than trusting a client field:
  // a course session's admission rules are frozen and must not be editable here,
  // and upsertTripRequirements has no independent course check.
  const trip = await getTripWithBooked(db, s.user.shopId, tripId);
  if (trip?.courseId) redirect(`${back}?notice=invalid`);
  const parsed = requirementsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?notice=invalid`);
  const specialties = z.array(specialtySchema).safeParse(formData.getAll("specialty").map(String));
  if (!specialties.success) redirect(`${back}?notice=invalid`);
  const saved = await upsertTripRequirements(db, {
    shopId: s.user.shopId,
    tripId,
    requiresWaiver: parsed.data.requiresWaiver === "on",
    minimumCertificationLevel: parsed.data.minimumCertificationLevel,
    requiredSpecialties: specialties.data,
    requiresNitrox: formData.get("requiresNitrox") === "on",
    requiresPayment: formData.get("requiresPayment") === "on",
  });
  revalidateAndRedirect(back, `${back}?notice=${saved ? "requirements" : "invalid"}`);
}

export async function assignGearAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const parsed = gearAssignmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?notice=gear-error`);
  const outcome = await assignGear(await getDb(), {
    shopId: s.user.shopId,
    bookingId: parsed.data.bookingId,
    gearItemId: parsed.data.gearItemId,
  });
  revalidateAndRedirect(back, `${back}?notice=${outcome.ok ? "gear-assigned" : "gear-error"}`);
}

export async function assignRecommendedGearAction(shopSlug: string, tripId: string) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const outcome = await assignRecommendedGear(await getDb(), s.user.shopId, tripId);
  revalidateAndRedirect(
    back,
    `${back}?notice=${outcome.assigned > 0 ? "gear-packed" : "gear-none"}`,
  );
}

export async function returnGearAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) redirect(`${back}?notice=gear-error`);
  const returned = await returnGear(await getDb(), s.user.shopId, assignmentId);
  revalidateAndRedirect(back, `${back}?notice=${returned ? "gear-returned" : "gear-error"}`);
}
