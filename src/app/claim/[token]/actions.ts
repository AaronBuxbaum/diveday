"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { recordDiverOwnLocaleForBooking } from "@/db/people";
import { claimPartySeat } from "@/db/seat-claims";
import { requestFirstHandLocale } from "@/i18n/request";
import { claimLinkPath, readinessLinkPath } from "@/lib/booking-capabilities";
import { diverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

const claimSchema = z.object({
  // Shared diver person-field bounds (src/lib/person-fields.ts).
  fullName: diverNameSchema,
  email: diverEmailSchema,
  phone: diverPhoneSchema.optional(),
});

/**
 * Claim one party seat from its bearer link. The booking, shop, and trip are
 * derived from the verified `claim` capability and nothing else — no id from
 * the client is trusted — and the same IP rate limit that guards every other
 * capability action throttles both guessing and replay spam ahead of
 * verification (the pattern `confirmContextFor` set, CR-013).
 *
 * Success hands the claimant straight to their own `/ready` page on a fresh
 * readiness capability: the claim link itself died inside the claim
 * transaction (every capability on the booking is revoked there), so the
 * URL they leave with is theirs, not the organizer's.
 */
export async function claimSeatAction(token: string, formData: FormData) {
  const base = claimLinkPath(token);
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("claim-token", ip), RATE_LIMITS.capabilityAction)).allowed
  ) {
    redirect(`${base}?error=rate`);
  }
  const parsed = claimSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) redirect(`${base}?error=fields`);

  const db = await getDb();
  const outcome = await claimPartySeat(db, {
    token,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });
  if (!outcome.ok) {
    // `invalid` redirects with no code at all: the token no longer verifies
    // (or never did), so the page itself renders the uniform "this link
    // isn't available" notice — one honest answer for every dead-link cause.
    if (outcome.reason === "invalid") redirect(base);
    const code =
      outcome.reason === "already_booked"
        ? "already"
        : outcome.reason === "course_prerequisite"
          ? "course"
          : "requirement";
    redirect(`${base}?error=${code}`);
  }

  // This form is the claimant's own device — first-hand evidence of the
  // language they read (docs ADR 20260731-per-person-notification-locale).
  // The booking-scoped writer refuses an identity-unconfirmed booking, which
  // is exactly right here too.
  await recordDiverOwnLocaleForBooking(db, {
    bookingId: outcome.bookingId,
    locale: await requestFirstHandLocale(),
  });

  const readiness = await issueBookingCapability(db, {
    shopId: outcome.shopId,
    bookingId: outcome.bookingId,
    purpose: "readiness",
  });
  // A just-claimed booking is live, so this only fails on something already
  // broken; landing back on the (now dead) claim link would read as a failed
  // claim, so fall back to the uniform notice only in that corner.
  if (!readiness) redirect(base);
  redirect(`${readinessLinkPath(readiness.token)}?saved=claimed`);
}
