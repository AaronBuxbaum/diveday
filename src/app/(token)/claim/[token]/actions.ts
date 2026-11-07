"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { recordDiverOwnLocaleForBooking } from "@/db/people";
import { claimPartySeatRecord, settleClaimedSeat } from "@/db/seat-claims";
import { requestFirstHandLocale } from "@/i18n/request";
import { claimLinkPath } from "@/lib/booking-capabilities";
import { parseForm } from "@/lib/form-parse";
import { diverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

const claimSchema = z.object({
  // Shared diver person-field bounds (src/lib/person-fields.ts).
  fullName: diverNameSchema,
  email: diverEmailSchema,
  // An empty box is no phone, as it always was: "" reads as absent.
  phone: z.preprocess((value) => value || undefined, diverPhoneSchema.optional()),
});

/**
 * Claim one party seat from its bearer link. The booking, shop, and trip are
 * derived from the verified `claim` capability and nothing else — no id from
 * the client is trusted — and the same IP rate limit that guards every other
 * capability action throttles both guessing and replay spam ahead of
 * verification (the pattern `confirmContextFor` set, CR-013).
 *
 * Every answer lands back on the claim page, which says what happened: the
 * seat is theirs (`?claimed=1`), the typed address already holds a seat on
 * this trip (`?error=held`, the link still live so they can use their own
 * address), a gate refused, or the link is dead and the page says why.
 */
export async function claimSeatAction(token: string, formData: FormData) {
  const base = claimLinkPath(token);
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("claim-token", ip), RATE_LIMITS.capabilityAction)).allowed
  ) {
    redirect(`${base}?error=rate`);
  }
  const parsed = parseForm(claimSchema, formData);
  if (!parsed.ok) redirect(`${base}?error=fields`);

  const db = await getDb();
  // This form is the claimant's own device — first-hand evidence of the
  // language they read (docs ADR 20260731-per-person-notification-locale).
  const ownLocale = await requestFirstHandLocale();
  const outcome = await claimPartySeatRecord(db, {
    token,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });
  if (!outcome.ok) {
    // `invalid` redirects with no code: the token no longer verifies, and the
    // page reads why from the seat and the trip.
    if (outcome.reason === "invalid") redirect(base);
    redirect(`${base}?error=${CLAIM_ERRORS[outcome.reason]}`);
  }

  // The booking-scoped writer refuses an identity-unconfirmed booking, which
  // is exactly right here too. After the response.
  after(async () => {
    await recordDiverOwnLocaleForBooking(db, {
      bookingId: outcome.bookingId,
      locale: ownLocale,
    });
    // The confirmation with its Sign step, the analytics event and the
    // activity trail.
    await settleClaimedSeat(db, outcome);
  });
  redirect(`${base}?claimed=1`);
}

const CLAIM_ERRORS = {
  already_booked: "held",
  course_prerequisite: "course",
  trip_prerequisite: "requirement",
} as const;
