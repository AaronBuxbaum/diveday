"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { openMinorSeatWaiver } from "@/db/seat-claims";
import { parseForm, single } from "@/lib/form-parse";
import {
  base,
  bounceTarget,
  contextFor,
  partySeatWaiverPath,
  refuseWhileHeld,
} from "./action-helpers";

const seatSchema = z.string().uuid();

/**
 * **"Sign Mia's waiver"** (H-20261014-parent-signs-minor-release, ADR 20261014-parent-signs-minor-release).
 * The lead opens the release of a seat they booked and declared "Under 18",
 * on their own device, and signs it as the parent: the waiver page asks for
 * the guardian's card beside the diver's signature for a declared minor.
 *
 * The lead's verified link is the authority and the posted seat id only says
 * which of *their* seats: `openMinorSeatWaiver` re-reads that the seat is in
 * this lead's party, in this shop, unclaimed, declared a minor, not held and
 * still owing a release, and refuses anything else with one answer. The
 * release is signed on the lead's own link (issue #2743), at
 * `partySeatWaiverPath`: no waiver link is minted, and nothing carries the
 * lead's token anywhere but the lead's own URL.
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
  redirect(partySeatWaiverPath(token, seat.data.bookingId));
}
