"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sendClaimedSeatConfirmation } from "@/db/notifications";
import { recordDiverOwnLocaleForBooking } from "@/db/people";
import { tellSeatAlreadyHeld } from "@/db/seat-already-held";
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
 * **A claim that worked and a claim for an address that already holds a seat
 * on the trip answer identically** (issue #2381): the same redirect, to the
 * same static page, with the same work done after the response. Anyone holding
 * a claim link can type any address, so a different answer for a booked
 * address would tell them who is on the manifest. The answer goes by email
 * instead, to the only person entitled to it: the claimant gets their booking
 * confirmation (their own prep link in it, the old claim link having died in
 * the claim transaction), and the holder of an already-held seat gets a note
 * naming it. The data layer still refuses the double seat.
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
  // Read before the claim, for both answers alike.
  const ownLocale = await requestFirstHandLocale();
  const outcome = await claimPartySeatRecord(db, {
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
    if (outcome.reason === "already_booked") {
      const { held } = outcome;
      if (held) after(() => tellSeatAlreadyHeld(db, { ...held, attempt: "claim" }));
      redirect(sentPath(base));
    }
    redirect(
      `${base}?error=${outcome.reason === "course_prerequisite" ? "course" : "requirement"}`,
    );
  }

  // The booking-scoped writer refuses an identity-unconfirmed booking, which
  // is exactly right here too. After the response, like the held-seat note.
  after(async () => {
    await recordDiverOwnLocaleForBooking(db, {
      bookingId: outcome.bookingId,
      locale: ownLocale,
    });
    // The waiver mail, the analytics event and the activity trail: all after
    // the response, so a claim that worked costs the caller no more time than
    // one that was refused.
    await settleClaimedSeat(db, outcome);
    await sendClaimedSeatConfirmation(db, outcome.shopId, outcome.bookingId);
  });
  redirect(sentPath(base));
}

/** Where both answers land: the claim URL with the static "check your email" page. */
function sentPath(base: string): string {
  return `${base}?sent=1`;
}
