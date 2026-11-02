"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { openMinorSeatWaiver } from "@/db/seat-claims";
import { parseForm, single } from "@/lib/form-parse";
import {
  PARTY_RETURN_COOKIE,
  PARTY_RETURN_MAX_AGE_SECONDS,
  partyReturnCookiePath,
  partyReturnCookieSecure,
} from "@/lib/party-return";
import { base, bounceTarget, contextFor, refuseWhileHeld } from "./action-helpers";

const seatSchema = z.string().uuid();

/**
 * **"Sign Mia's waiver"** (H-124, ADR 20261014-parent-signs-minor-release).
 * The lead opens the release of a seat they booked and declared "Under 18",
 * on their own device, and signs it as the parent: the waiver page asks for
 * the guardian's card beside the diver's signature for a declared minor.
 *
 * The lead's verified link is the authority and the posted seat id only says
 * which of *their* seats: `openMinorSeatWaiver` re-reads that the seat is in
 * this lead's party, in this shop, unclaimed, declared a minor, not held and
 * still owing a release, and refuses anything else with one answer. The
 * waiver link is minted here, on the tap, never printed into the lead's page.
 */
const minorSeatForm = z.object({ bookingId: single(seatSchema) });

export async function signMinorWaiverAction(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const seat = parseForm(minorSeatForm, formData);
  if (!seat.ok) redirect(`${base(token)}?error=minor-waiver#party-seats`);
  const opened = await openMinorSeatWaiver(ctx.db, {
    shopId: ctx.data.shop.id,
    leadBookingId: ctx.bookingId,
    seatBookingId: seat.data.bookingId,
  });
  if (!opened.ok) redirect(`${base(token)}?error=minor-waiver#party-seats`);
  // Once it is signed, back to this page's party panel, so the next child's
  // release is one tap away (dive-domain review F6). The lead's own token,
  // sent only on that release's path; the waiver action re-checks it.
  (await cookies()).set(PARTY_RETURN_COOKIE, token, {
    path: partyReturnCookiePath(opened.token),
    maxAge: PARTY_RETURN_MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    secure: partyReturnCookieSecure(),
  });
  redirect(`/waivers/${opened.token}`);
}
