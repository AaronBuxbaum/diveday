"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createBookingParty, getBookingForTrip } from "@/db/bookings";
import { startBookingCheckout } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { setBookingNitrox } from "@/db/nitrox";
import { sendAndRecordNotification } from "@/db/notifications";
import { saveRentalFit } from "@/db/rental-fit";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { joinTripWaitlist } from "@/db/waitlist";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";

/** Bound to each action so the public page can stay a pure renderer. */
export type TripRef = { shopSlug: string; tripId: string };
export type RentalFitRef = TripRef & { shopId: string; bookingId: string; personId: string };

const bookSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  phone: z.string().trim().max(30).optional(),
  buddyPreference: z.string().trim().max(300).optional(),
});

const rentalFitSchema = z.object({
  bcd: z.string().optional(),
  regulator: z.string().optional(),
  wetsuit: z.string().optional(),
  maskFins: z.string().optional(),
  weights: z.string().optional(),
  nitrox: z.string().optional(),
  bcdSize: z.string().trim().max(20),
  wetsuitSize: z.string().trim().max(20),
  bootSize: z.string().trim().max(20),
  finSize: z.string().trim().max(20),
  weightPreference: z.string().trim().max(80),
  note: z.string().trim().max(300),
});

export async function bookSpot({ shopSlug, tripId }: TripRef, formData: FormData) {
  const partySize = z.coerce.number().int().min(1).max(6).safeParse(formData.get("partySize"));
  if (!partySize.success) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=invalid`);
  const party = Array.from({ length: partySize.data }, (_, index) =>
    bookSchema.safeParse({
      fullName: formData.get(`fullName-${index}`),
      email: formData.get(`email-${index}`),
    }),
  );
  const validParty = party.flatMap((entry) => (entry.success ? [entry.data] : []));
  if (validParty.length !== partySize.data)
    redirect(`/shop/${shopSlug}/schedule/${tripId}?error=invalid`);
  const dbi = await getDb();
  const shopNow = await getShopBySlug(dbi, shopSlug);
  if (!shopNow) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=unavailable`);
  const outcome = await createBookingParty(
    dbi,
    validParty.map((entry) => ({
      shopId: shopNow.id,
      tripId,
      fullName: entry.fullName,
      email: entry.email,
    })),
  );
  if (!outcome.ok) {
    const code =
      outcome.reason === "trip_full"
        ? "full"
        : outcome.reason === "already_booked"
          ? "already"
          : outcome.reason === "course_unstaffed"
            ? "course-unavailable"
            : outcome.reason === "course_prerequisite"
              ? "course-prerequisite"
              : "unavailable";
    redirect(`/shop/${shopSlug}/schedule/${tripId}?error=${code}`);
  }
  const primaryBookingId = outcome.bookings[0]?.bookingId;
  if (!primaryBookingId) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=unavailable`);
  const [confirmedBooking, tripNow] = await Promise.all([
    getBookingForTrip(dbi, tripId, primaryBookingId),
    getTripWithBooked(dbi, shopNow.id, tripId),
  ]);
  if (confirmedBooking?.person.email && tripNow) {
    try {
      const delivery = await sendAndRecordNotification(dbi, {
        kind: "booking_confirmation",
        bookingId: primaryBookingId,
        shopId: shopNow.id,
        to: confirmedBooking.person.email,
        diverName: confirmedBooking.person.fullName,
        shopName: shopNow.name,
        tripTitle: tripNow.title,
        startsAt: tripNow.startsAt,
        endsAt: tripNow.endsAt,
        timezone: shopNow.timezone,
      });
      if (delivery.status === "failed") {
        console.error("Booking confirmation notification failed", {
          bookingId: primaryBookingId,
        });
      }
    } catch {
      // Email must never turn a completed, capacity-safe booking into an error page.
      console.error("Booking confirmation notification could not be prepared", {
        bookingId: primaryBookingId,
      });
    }
  }
  // Pay at booking: when the shop can take money and the trip is priced, the
  // party goes straight to the shop's own hosted Stripe Checkout. The seats
  // are already committed above, so any failure here — no connected account,
  // no configured origin, Stripe down — degrades to the ordinary
  // book-now-pay-later confirmation, never to a lost booking.
  const base = `/shop/${shopSlug}/schedule/${tripId}`;
  const checkoutUrl = await startCheckoutUrl(dbi, {
    shopId: shopNow.id,
    shopSlug,
    tripId,
    bookingIds: outcome.bookings.map((entry) => entry.bookingId),
    primaryBookingId,
    customerEmail: validParty[0]?.email ?? "",
  });
  if (checkoutUrl) {
    revalidatePath(base);
    redirect(checkoutUrl);
  }
  revalidateAndRedirect(base, `${base}?booking=${primaryBookingId}`);
}

/** The hosted payment page for these fresh bookings, or null when pay-at-booking can't run. */
async function startCheckoutUrl(
  dbi: Awaited<ReturnType<typeof getDb>>,
  input: {
    shopId: string;
    shopSlug: string;
    tripId: string;
    bookingIds: string[];
    primaryBookingId: string;
    customerEmail: string;
  },
): Promise<string | null> {
  const origin = publicAppUrl();
  if (!origin || !input.customerEmail) return null;
  const returnBase = `${origin}/shop/${input.shopSlug}/schedule/${input.tripId}?booking=${input.primaryBookingId}`;
  const outcome = await startBookingCheckout(dbi, {
    shopId: input.shopId,
    tripId: input.tripId,
    bookingIds: input.bookingIds,
    customerEmail: input.customerEmail,
    successUrl: returnBase,
    cancelUrl: `${returnBase}&pay=cancelled`,
  }).catch(() => null);
  return outcome?.ok ? (outcome.checkout.checkoutUrl ?? null) : null;
}

/**
 * "Finish paying" from the confirmation panel: reuses the open Stripe session
 * when one exists, mints a new one after an expiry, and sends the diver to it.
 */
export async function payForBooking(
  { shopSlug, tripId, shopId, bookingId }: Omit<RentalFitRef, "personId">,
  _formData: FormData,
) {
  const base = `/shop/${shopSlug}/schedule/${tripId}`;
  const dbi = await getDb();
  const confirmed = await getBookingForTrip(dbi, tripId, bookingId);
  const checkoutUrl = confirmed?.person.email
    ? await startCheckoutUrl(dbi, {
        shopId,
        shopSlug,
        tripId,
        bookingIds: [bookingId],
        primaryBookingId: bookingId,
        customerEmail: confirmed.person.email,
      })
    : null;
  if (checkoutUrl) redirect(checkoutUrl);
  redirect(`${base}?booking=${bookingId}&error=pay`);
}

export async function joinWaitlist({ shopSlug, tripId }: TripRef, formData: FormData) {
  const parsed = bookSchema.safeParse({
    fullName: formData.get("fullName-0"),
    email: formData.get("email-0"),
  });
  if (!parsed.success) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=invalid`);
  const dbi = await getDb();
  const shopNow = await getShopBySlug(dbi, shopSlug);
  if (!shopNow) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=unavailable`);
  const outcome = await joinTripWaitlist(dbi, {
    shopId: shopNow.id,
    tripId,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone || undefined,
  });
  if (outcome.ok || outcome.reason === "already_waitlisted") {
    revalidateAndRedirect(
      `/shop/${shopSlug}/schedule/${tripId}`,
      `/shop/${shopSlug}/schedule/${tripId}?waitlist=${outcome.entryId}`,
    );
  }
  const code =
    outcome.reason === "trip_available"
      ? "available"
      : outcome.reason === "already_booked"
        ? "already"
        : "unavailable";
  redirect(`/shop/${shopSlug}/schedule/${tripId}?error=${code}`);
}

/**
 * Saves the diver's reusable rental fit and, separately, whether they want
 * enriched air on this booking. The nitrox write is card-gated in the database
 * (src/db/nitrox.ts): if it is refused, the fit is still saved and the diver is
 * told why the mix did not stick, rather than silently getting air.
 */
export async function saveRentalFitRequest(
  { shopSlug, tripId, shopId, bookingId, personId }: RentalFitRef,
  formData: FormData,
) {
  const base = `/shop/${shopSlug}/schedule/${tripId}`;
  const parsed = rentalFitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base}?booking=${bookingId}&error=fit`);
  const db = await getDb();
  const saved = await saveRentalFit(db, {
    shopId,
    personId,
    rentsBcd: parsed.data.bcd === "on",
    rentsRegulator: parsed.data.regulator === "on",
    rentsWetsuit: parsed.data.wetsuit === "on",
    rentsMaskFins: parsed.data.maskFins === "on",
    rentsWeights: parsed.data.weights === "on",
    bcdSize: parsed.data.bcdSize,
    wetsuitSize: parsed.data.wetsuitSize,
    bootSize: parsed.data.bootSize,
    finSize: parsed.data.finSize,
    weightPreference: parsed.data.weightPreference,
    note: parsed.data.note,
  });
  const nitrox = await setBookingNitrox(db, {
    shopId,
    bookingId,
    wantsNitrox: parsed.data.nitrox === "on",
  });
  const result = !saved ? "error=fit" : nitrox.ok ? "fit=saved" : "error=nitrox-card";
  revalidateAndRedirect(base, `${base}?booking=${bookingId}&${result}`);
}
