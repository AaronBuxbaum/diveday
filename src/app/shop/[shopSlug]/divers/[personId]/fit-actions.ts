"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonOverrideGearRequest, loadActiveStaffRoles } from "@/db/authz";
import { getRentalFit, saveRentalFit, setNeedsStaffFit } from "@/db/rental-fit";
import { canOverrideGearRequest, isStaff } from "@/lib/authz";
import { revalidateAndRedirect } from "@/lib/navigation";
import { RENTAL_FIT_TEXT_LIMITS, suitFlagsFromPost } from "@/lib/rentals";
import { backTo, requireDiverActionContext } from "./action-helpers";

const needsStaffFitSchema = z.object({
  needed: z.string().optional(),
  needsStaffFitNote: z.string().trim().max(200).optional(),
});
const profileSchema = z.object({
  bcd: z.string().optional(),
  regulator: z.string().optional(),
  // One suit choice rather than two checkboxes (H-78); see `suitFlagsFromPost`.
  suit: z.string().optional(),
  maskFins: z.string().optional(),
  weights: z.string().optional(),
  diveComputer: z.string().optional(),
  gopro: z.string().optional(),
  hood: z.string().optional(),
  gloves: z.string().optional(),
  torch: z.string().optional(),
  smb: z.string().optional(),
  // Optional, not required, and deliberately not `.default("")`. The form
  // renders a size box only for an item `offeredRentableItems(shop.rentalItems)`
  // says the shop offers, so a shop that has dropped weights from its catalog
  // posts no `weightPreference` key at all -- and a required field failed on
  // `undefined`, refusing every save that shop could make with "Check the
  // details and try again." on a form where every visible box was right
  // (issue #1062). `.default("")` parses, and then blanks a stored size for
  // every item the shop does not currently offer, which is the destructive
  // half of the same bug; `saveRentalFit` leaves an absent size alone instead.
  bcdSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  wetsuitSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  drysuitSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  hoodSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  gloveSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  finSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),
  weightPreference: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.weightPreference).optional(),
});

export async function saveProfileAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-fit", "fit");
  personId = context.personId;
  const { base, db, staff } = context;
  // The gate is on *overriding* a stated request, not on writing the record
  // (H-06, ADR 20260724-gear-fit-fallback). A diver with nothing on file has
  // stated nothing to override, so recording their sizes for the first time is
  // ordinary data entry — the Saturday walk-up whose only staff on the floor
  // are the captain and a deckhand must not end up on a napkin. Changing a fit
  // that already exists is the in-water judgement call, and stays gated.
  const existing = await getRentalFit(db, staff.user.shopId, personId);
  if (
    existing &&
    !(await canPersonOverrideGearRequest(db, staff.user.shopId, staff.user.personId))
  ) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-fit", "fit"));
    return;
  }
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(backTo(base, "invalid", "fit"));
  const saved = await saveRentalFit(db, {
    shopId: staff.user.shopId,
    personId,
    // An item this shop's catalog has dropped renders no checkbox in
    // `GearAndSizes.tsx`, so it posts nothing and arrives here as `false`.
    // `saveRentalFit` re-derives the offered set and leaves those columns alone
    // rather than reading the silence as "no" (issue #1755) — which matters
    // most on this writer of the two, because there is a staffer present,
    // correcting a boot size, who would never be told.
    rentsBcd: parsed.data.bcd === "on",
    rentsRegulator: parsed.data.regulator === "on",
    ...suitFlagsFromPost(parsed.data.suit),
    rentsMaskFins: parsed.data.maskFins === "on",
    rentsWeights: parsed.data.weights === "on",
    rentsDiveComputer: parsed.data.diveComputer === "on",
    rentsGopro: parsed.data.gopro === "on",
    rentsHood: parsed.data.hood === "on",
    rentsGloves: parsed.data.gloves === "on",
    rentsTorch: parsed.data.torch === "on",
    rentsSmb: parsed.data.smb === "on",
    bcdSize: parsed.data.bcdSize,
    wetsuitSize: parsed.data.wetsuitSize,
    drysuitSize: parsed.data.drysuitSize,
    hoodSize: parsed.data.hoodSize,
    gloveSize: parsed.data.gloveSize,
    // One shoe-size answer, written to both columns — see RentalFit.tsx.
    bootSize: parsed.data.finSize,
    finSize: parsed.data.finSize,
    weightPreference: parsed.data.weightPreference,
  });
  revalidateAndRedirect(base, backTo(base, saved ? "profile-saved" : "invalid", "fit"));
}

/**
 * Flag (or clear) a diver for hands-on fitting at check-in — the H-06 fallback
 * for a size the shop can't fill.
 *
 * The two directions carry different authority, so they gate differently even
 * though one action serves both. **Raising** is open to every staff member: it
 * is the boat's own work, and it escalates to a human rather than overwriting
 * the diver's stated request. **Clearing** asserts "we can pack their stated
 * size after all" — the judgement call — so it takes the override gate. The
 * clear direction is the *absence* of a form field, which is exactly why this
 * has to be checked here and not left to the button the page renders.
 */
export async function setNeedsStaffFitAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-fit", "fit");
  personId = context.personId;
  const { base, db, staff } = context;
  const roles = await loadActiveStaffRoles(db, staff.user.shopId, staff.user.personId);
  if (!roles || !isStaff(roles)) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-fit", "fit"));
    return;
  }
  const parsed = needsStaffFitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(backTo(base, "invalid", "fit"));
  const needed = parsed.data.needed === "on";
  // Hiding the button is the page layer; this is the server layer ADR-0006
  // asks for. Without it a captain clears a flag by submitting the form with
  // no `needed` field, and the diver goes back on the list at a size the shop
  // already said it was short of — with the attribution wiped in the same
  // statement, so nothing records that it happened.
  if (!needed && !canOverrideGearRequest(roles)) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-fit", "fit"));
    return;
  }
  const saved = await setNeedsStaffFit(db, {
    shopId: staff.user.shopId,
    personId,
    needed,
    note: parsed.data.needsStaffFitNote,
    byPersonId: staff.user.personId,
  });
  const notice = !saved ? "invalid" : needed ? "fit-flagged" : "fit-cleared";
  revalidateAndRedirect(base, backTo(base, notice, "fit"));
}
