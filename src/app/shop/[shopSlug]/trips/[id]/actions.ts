"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { cancelBooking, createBooking, restoreBooking } from "@/db/bookings";
import { getDb } from "@/db/client";
import { setBookingPayment } from "@/db/payments";
import { upsertTripRequirements } from "@/db/readiness";
import { type CancellationRefundOutcome, refundBookingOnCancellation } from "@/db/refunds";
import { getShopById } from "@/db/shops";
import {
  getTripWithBooked,
  setTripCrew,
  setTripStatus,
  updateTrip,
  updateTripConditions,
} from "@/db/trips";
import { inviteWaitlistDiver, joinTripWaitlist } from "@/db/waitlist";
import { issueAndDeliverWaiver } from "@/db/waiver-issue";
import { recordInPersonWaiver } from "@/db/waivers";
import { revalidateAndRedirect } from "@/lib/navigation";
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
  depositDollars: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().nonnegative().finite().optional(),
  ),
  cancellationWindowHours: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(0).max(720).optional(),
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

const addDiverSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  phone: z.string().trim().max(30).optional(),
});

function parseAddDiver(formData: FormData) {
  return addDiverSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
  });
}

const backPath = (shopSlug: string, tripId: string) => `/shop/${shopSlug}/trips/${tripId}`;

export async function saveDetails(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?notice=invalid`);
  const {
    title,
    description,
    date,
    startTime,
    endTime,
    capacity,
    plannedDives,
    priceDollars,
    depositDollars,
    cancellationWindowHours,
  } = parsed.data;
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
    depositCents: depositDollars === undefined ? null : Math.round(depositDollars * 100),
    cancellationWindowHours: cancellationWindowHours ?? null,
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

/** Staff-entered booking for walk-ins or divers tracked in another system. */
export async function addBookingAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const parsed = parseAddDiver(formData);
  if (!parsed.success) redirect(`${back}?notice=diver-invalid`);
  const outcome = await createBooking(await getDb(), {
    shopId: s.user.shopId,
    tripId,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });
  if (!outcome.ok) {
    const code =
      outcome.reason === "trip_full"
        ? "diver-full"
        : outcome.reason === "already_booked"
          ? "diver-already"
          : outcome.reason === "course_unstaffed"
            ? "diver-course-unstaffed"
            : outcome.reason === "course_prerequisite"
              ? "diver-course-prerequisite"
              : "diver-unavailable";
    redirect(`${back}?notice=${code}`);
  }
  revalidateAndRedirect(back, `${back}?notice=diver-added&bid=${outcome.bookingId}`);
}

/** Staff-entered wait-list entry — only valid once the trip is actually full. */
export async function addToWaitlistAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const parsed = parseAddDiver(formData);
  if (!parsed.success) redirect(`${back}?notice=diver-invalid`);
  const outcome = await joinTripWaitlist(await getDb(), {
    shopId: s.user.shopId,
    tripId,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });
  if (outcome.ok || outcome.reason === "already_waitlisted") {
    revalidateAndRedirect(back, `${back}?notice=diver-waitlisted`);
  }
  const code =
    outcome.reason === "trip_available"
      ? "diver-waitlist-available"
      : outcome.reason === "already_booked"
        ? "diver-already"
        : "diver-unavailable";
  redirect(`${back}?notice=${code}`);
}

/**
 * What a one-tap wait-list invite reports back to the control: `sent` when the
 * freed-seat email actually went out through the notification seam, `fallback`
 * when it didn't (no provider configured, or the diver has no address on file)
 * so the UI opens the prewritten mailto/copy composer instead of pretending
 * mail is on its way. Either way the invite is stamped so nobody double-invites.
 */
export type WaitlistInviteResult = "sent" | "fallback";

/**
 * Invite a wait-list diver to grab a freed seat: stamps `invitedAt` (so the
 * entry reads "Invited just now" and two staff don't both reach out) and emails
 * them the trip's booking link through the shared notification seam. When email
 * isn't wired up, the control falls back to the composer — the send is the
 * default now, the composer is the safety net.
 */
export async function inviteWaitlistAction(
  shopSlug: string,
  tripId: string,
  entryId: string,
): Promise<WaitlistInviteResult> {
  const s = await requireStaffSession();
  const result = await inviteWaitlistDiver(await getDb(), {
    shopId: s.user.shopId,
    shopSlug,
    entryId,
  });
  revalidatePath(backPath(shopSlug, tripId));
  return result.ok && result.delivery === "sent" ? "sent" : "fallback";
}

const REFUND_NOTICE: Record<CancellationRefundOutcome["status"], string> = {
  refunded: "booking-removed-refunded",
  forfeit: "booking-removed-forfeit",
  manual: "booking-removed-refund-manual",
  failed: "booking-removed-refund-failed",
  // No stated window, or nothing captured: today's plain "spot is open" notice.
  no_policy: "booking-removed",
  unpaid: "booking-removed",
};

export async function removeBookingAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) redirect(back);
  const dbi = await getDb();
  await cancelBooking(dbi, s.user.shopId, bookingId);
  // A cancel inside the shop's stated window auto-refunds a Stripe payment;
  // everything else (no window, counter payment, Stripe off) degrades to the
  // staff-run refund the notice calls out. The seat is already freed above, so
  // a refund failure never blocks the cancellation (docs H-07).
  const refund = await refundBookingOnCancellation(dbi, {
    shopId: s.user.shopId,
    bookingId,
  });
  revalidateAndRedirect(back, `${back}?notice=${REFUND_NOTICE[refund.status]}&bid=${bookingId}`);
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
  // Same issue-and-deliver path the Today/Blockers one-tap sends use, so the
  // roster never diverges from the queue. The private link is always surfaced
  // here so staff can hand it over when email delivery isn't `sent`.
  const outcome = await issueAndDeliverWaiver(await getDb(), s.user.shopId, bookingId);
  if (!outcome.ok) {
    redirect(
      `${back}?notice=${outcome.reason === "already_completed" ? "waiver-complete" : "waiver-error"}`,
    );
  }
  revalidateAndRedirect(
    back,
    `${back}?notice=waiver-link&bid=${bookingId}&waiver=${outcome.token}`,
  );
}

/**
 * Staff records that a diver signed a paper release in person or on shore, for a
 * diver the app never sees sign. Same shop-scoped session gate as every other
 * roster action; the accountable staff member is stamped on the record. Requires
 * an explicit medical-clear attestation — a flagged medical must go through the
 * diver-facing link, which captures the questionnaire and routes to review.
 */
export async function markWaiverInPersonAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) redirect(`${back}?notice=waiver-error`);
  const outcome = await recordInPersonWaiver(await getDb(), {
    shopId: s.user.shopId,
    bookingId,
    recordedByPersonId: s.user.personId,
    medicalAttested: formData.get("medicalAttested") === "on",
  });
  const notice = outcome.ok
    ? "waiver-in-person"
    : outcome.reason === "medical_attestation_required"
      ? "waiver-medical-attestation"
      : "waiver-error";
  revalidateAndRedirect(back, `${back}?notice=${notice}&bid=${bookingId}`);
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
