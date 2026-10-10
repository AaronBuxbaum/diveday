"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { confirmCarriedFacts } from "@/db/bookings";
import { setBookingNitrox } from "@/db/nitrox";
import { saveRentalFit } from "@/db/rental-fit";
import { revalidateAndRedirect } from "@/lib/navigation";
import { seatRentalAnswer } from "@/lib/participant-types";
import { nitroxAvailableOn, RENTAL_FIT_TEXT_LIMITS, suitFlagsFromPost } from "@/lib/rentals";
import { base, bounceTarget, contextFor, refuseWhileHeld } from "./action-helpers";

const fitSchema = z.object({
  bcd: z.string().optional(),
  regulator: z.string().optional(),
  // The suit is one choice, not two checkboxes (H-78): `RentalFitForm` posts
  // `suit`, and `suitFlagsFromPost` turns it into the three suit columns.
  suit: z.string().optional(),
  maskFins: z.string().optional(),
  weights: z.string().optional(),
  diveComputer: z.string().optional(),
  gopro: z.string().optional(),
  hood: z.string().optional(),
  gloves: z.string().optional(),
  torch: z.string().optional(),
  smb: z.string().optional(),
  nitrox: z.string().optional(),
  // Optional, and deliberately not `.default("")` — the same rule the staff
  // record's `profileSchema` keeps, for the same reason (issue #1062).
  // `RentalFitForm` renders a size box only for an item
  // `offeredRentableItems(shop.rentalItems)` says the shop offers, so a shop
  // that does not rent drysuits posts no `drysuitSize` key at all, and a
  // required field failed on `undefined` — refusing every fit save that shop's
  // divers could make with "Check the details and try again." on a form where
  // every visible box was right. `.default("")` parses and then blanks a
  // stored size for every item the shop does not currently offer, which is the
  // destructive half of the same bug; `saveRentalFit` leaves an absent size
  // alone instead (`src/db/rental-fit.ts`).
  bcdSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  wetsuitSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  drysuitSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  hoodSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  gloveSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  finSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  weightPreference: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.weightPreference).optional(),
});

export async function saveFitFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const parsed = fitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=fit`);
  // A snorkeler's form shows surface kit only (ADR 20261007-participant-types).
  const said = (kind: string, posted: string | undefined) =>
    seatRentalAnswer(ctx.data.participantType, kind, posted);
  const saved = await saveRentalFit(ctx.db, {
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    // An item the shop's catalog has dropped renders no checkbox in
    // `RentalFitForm`, so it posts nothing and arrives here as `false`.
    // `saveRentalFit` re-derives the offered set and leaves those columns alone
    // rather than reading the silence as "no" (issue #1755) — the same posture
    // the nitrox request takes below, and the mirror of the absent-size rule.
    rentsBcd: said("bcd", parsed.data.bcd),
    rentsRegulator: said("regulator", parsed.data.regulator),
    // Wetsuit, drysuit and "I dive dry" as one answer, so a diver can say they
    // are in their own drysuit and can never be packed two suits (H-78).
    ...suitFlagsFromPost(parsed.data.suit),
    rentsMaskFins: said("mask_fins", parsed.data.maskFins),
    rentsWeights: said("weights", parsed.data.weights),
    rentsDiveComputer: said("dive_computer", parsed.data.diveComputer),
    rentsGopro: said("gopro", parsed.data.gopro),
    rentsHood: said("hood", parsed.data.hood),
    rentsGloves: said("gloves", parsed.data.gloves),
    rentsTorch: said("torch", parsed.data.torch),
    rentsSmb: said("smb", parsed.data.smb),
    bcdSize: parsed.data.bcdSize,
    wetsuitSize: parsed.data.wetsuitSize,
    // On the drysuit grid, not the wetsuit's (issue 1414) — one size, and no boot
    // size beside it: on most rental drysuits the boots are part of the suit.
    // A fleet whose suits take separate rock boots says so in the size itself,
    // which is why the staff-side box is free text (`src/lib/dive-prep.ts`).
    drysuitSize: parsed.data.drysuitSize,
    hoodSize: parsed.data.hoodSize,
    gloveSize: parsed.data.gloveSize,
    // Fins and boots are one shoe-size answer on the diver's form now, written
    // to both columns so the packing list, the manifest and the CSV export all
    // keep reading the field they already read.
    bootSize: parsed.data.finSize,
    finSize: parsed.data.finSize,
    weightPreference: parsed.data.weightPreference,
    // Deliberately absent, and `saveRentalFit` reads that absence as "leave the
    // stored note alone": the note is `saveNoteFromReady`'s to write since issue
    // 627, so a diver nudging a boot size here must not silently delete words
    // the crew is relying on.
    note: undefined,
  });
  // The nitrox checkbox is only in this form when the shop currently fills
  // nitrox *and* the course being taught runs on it (RentalFitForm.tsx) — when
  // it isn't, the field is simply absent from every submission, whatever the
  // diver's actual request. Re-derived here rather than trusted from the post:
  // a hand-crafted `nitrox=on` must not record a request the form would not
  // have offered. Only written when the box could have been there at all, so
  // an unrelated save (a note, a size) never silently clears a request
  // recorded while the shop still offered it.
  if (nitroxAvailableOn(ctx.data.shop.rentalItems, ctx.data.trip.course)) {
    const wantsNitrox = parsed.data.nitrox === "on";
    await setBookingNitrox(ctx.db, {
      shopId: ctx.data.shop.id,
      bookingId: ctx.bookingId,
      wantsNitrox,
    });
  }
  // Saving sizes is one of the three ways to answer "Anything changed?", so it
  // settles that step too. A diver who fixes a wetsuit size must not then be
  // asked to confirm that they fixed it.
  await confirmCarriedFacts(ctx.db, { shopId: ctx.data.shop.id, bookingId: ctx.bookingId });
  const result = saved ? "saved=fit" : "error=fit";
  revalidateAndRedirect(base(token), `${base(token)}?${result}`);
}

/**
 * **"Nothing changed."** — the primary answer to the returning diver's one
 * question (ADR 20260904-reef-all-the-way-down, D15 with D19 folded in).
 *
 * The whole of it is a stamp on this booking. It writes no fact, because the
 * point of the answer is that none of them moved; the three doors beside it
 * each write their own single fact and stamp this in the same breath.
 */
export async function confirmCarriedFactsFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const saved = await confirmCarriedFacts(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  revalidateAndRedirect(base(token), `${base(token)}?${saved ? "saved=changes" : "error=changes"}`);
}

const tanksSchema = z.object({ nitrox: z.string().optional() });

/**
 * **Air or nitrox**, on its own.
 *
 * Its own action and its own scope, which is the whole point of the question
 * being a door rather than a field of the dense prep form: a partial post to
 * that form would clear sizes the diver never touched (issue #1175's named
 * trap). This writes `bookings.wants_nitrox` and nothing else.
 *
 * The offer is re-derived here rather than trusted from the post, exactly as
 * `saveFitFromReady` does it: a hand-crafted `nitrox=on` must not record a
 * request against a shop that does not fill nitrox, or a course that cannot run
 * on it. When the shop could not have asked, the field is ignored entirely
 * rather than read as a `false` — so an unrelated tap never silently clears a
 * request recorded while the shop still offered it.
 */
export async function saveTanksFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const parsed = tanksSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=tanks`);
  if (!nitroxAvailableOn(ctx.data.shop.rentalItems, ctx.data.trip.course)) {
    redirect(`${base(token)}?error=tanks`);
  }
  const saved = await setBookingNitrox(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    wantsNitrox: parsed.data.nitrox === "on",
  });
  if (!saved) redirect(`${base(token)}?error=tanks`);
  await confirmCarriedFacts(ctx.db, { shopId: ctx.data.shop.id, bookingId: ctx.bookingId });
  revalidateAndRedirect(base(token), `${base(token)}?saved=tanks`);
}
