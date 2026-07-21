"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { startBookingCheckout } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { setBookingNitrox } from "@/db/nitrox";
import { getReadyPageData } from "@/db/ready";
import { saveRentalFit } from "@/db/rental-fit";
import { issueWaiverRequest, saveBookingEmergencyContact } from "@/db/waivers";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { verifyReadinessToken } from "@/lib/readiness-links";

/**
 * The transactional half of the diver's readiness page. Every action is
 * authorized the same way: the signed readiness token proves the diver owns
 * this booking, and every write is then scoped to that booking's shop/person.
 * A bearer of this token can only ever touch its own booking — never another
 * diver's — and the readiness state itself stays server-authoritative.
 */

const base = (token: string) => `/ready/${token}`;

/** Resolve the token to its booking + shop context, or bounce to a plain notice. */
async function contextFor(token: string) {
  const bookingId = verifyReadinessToken(token);
  if (!bookingId) return null;
  const db = await getDb();
  const data = await getReadyPageData(db, bookingId);
  if (!data || data.detail.cancelled) return null;
  return { db, bookingId, data };
}

/**
 * Sign the waiver from the page. We can't reconstruct an existing bearer token
 * (only its hash is stored), so this issues a fresh link for the booking and
 * sends the diver straight to it. Reissuing supersedes any prior pending link,
 * which is the intended behaviour.
 */
export async function signWaiverFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx) redirect(base(token));
  const issued = await issueWaiverRequest(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  if (!issued.ok) redirect(`${base(token)}?error=waiver`);
  redirect(`/waivers/${issued.token}`);
}

export async function saveEmergencyContactFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx) redirect(base(token));
  const name = String(formData.get("emergencyContactName") ?? "").trim();
  const phone = String(formData.get("emergencyContactPhone") ?? "").trim();
  await saveBookingEmergencyContact(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    name,
    phone,
  });
  // A contact is only usable with a reachable number, so only a name+phone pair
  // earns the "saved" confirmation; a partial entry is nudged, never thanked.
  const complete = Boolean(name && phone);
  revalidateAndRedirect(
    base(token),
    `${base(token)}?saved=${complete ? "contact" : "contact-empty"}`,
  );
}

const fitSchema = z.object({
  bcd: z.string().optional(),
  regulator: z.string().optional(),
  wetsuit: z.string().optional(),
  maskFins: z.string().optional(),
  weights: z.string().optional(),
  diveComputer: z.string().optional(),
  gopro: z.string().optional(),
  nitrox: z.string().optional(),
  bcdSize: z.string().trim().max(20),
  wetsuitSize: z.string().trim().max(20),
  bootSize: z.string().trim().max(20),
  finSize: z.string().trim().max(20),
  weightPreference: z.string().trim().max(80),
  note: z.string().trim().max(300),
});

export async function saveFitFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx) redirect(base(token));
  const parsed = fitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=fit`);
  const saved = await saveRentalFit(ctx.db, {
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    rentsBcd: parsed.data.bcd === "on",
    rentsRegulator: parsed.data.regulator === "on",
    rentsWetsuit: parsed.data.wetsuit === "on",
    rentsMaskFins: parsed.data.maskFins === "on",
    rentsWeights: parsed.data.weights === "on",
    rentsDiveComputer: parsed.data.diveComputer === "on",
    rentsGopro: parsed.data.gopro === "on",
    bcdSize: parsed.data.bcdSize,
    wetsuitSize: parsed.data.wetsuitSize,
    bootSize: parsed.data.bootSize,
    finSize: parsed.data.finSize,
    weightPreference: parsed.data.weightPreference,
    note: parsed.data.note,
  });
  const nitrox = await setBookingNitrox(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    wantsNitrox: parsed.data.nitrox === "on",
  });
  const result = !saved ? "error=fit" : nitrox.ok ? "saved=fit" : "error=nitrox-card";
  revalidateAndRedirect(base(token), `${base(token)}?${result}`);
}

/**
 * Pay for the trip from the page. Abandonment already degrades safely — the
 * seat is held regardless — so a failure here just returns the diver to the
 * page with a gentle notice, never to an error.
 */
export async function payFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx) redirect(base(token));
  const origin = publicAppUrl();
  if (!ctx.data.canPay || !origin || !ctx.data.person.email) {
    redirect(`${base(token)}?error=pay`);
  }
  const returnBase = `${origin}${base(token)}`;
  const outcome = await startBookingCheckout(ctx.db, {
    shopId: ctx.data.shop.id,
    tripId: ctx.data.trip.id,
    bookingIds: [ctx.bookingId],
    customerEmail: ctx.data.person.email,
    successUrl: `${returnBase}?pay=paid`,
    cancelUrl: `${returnBase}?pay=cancelled`,
  }).catch(() => null);
  const url = outcome?.ok ? outcome.checkout.checkoutUrl : null;
  if (!url) redirect(`${base(token)}?error=pay`);
  redirect(url);
}
