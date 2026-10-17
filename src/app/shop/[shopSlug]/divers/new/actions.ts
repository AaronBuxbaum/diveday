"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { seatNewDiverAction, seatWalkInPartyAction } from "@/app/actions/seat-diver";
import { SEAT_SURFACES, type SeatSurfaceId } from "@/app/actions/seat-diver-surfaces";
import { addToWaitlistAction } from "@/app/shop/[shopSlug]/trips/[id]/roster-seating-actions";
import { getDb } from "@/db/client";
import { createDiver, findSimilarDivers } from "@/db/divers";
import { discardFormDraft } from "@/db/form-drafts";
import { parseForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import {
  blankableDiverEmailSchema,
  blankableDiverNameSchema,
  diverPhoneSchema,
} from "@/lib/person-fields";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { readWalkInParty } from "@/lib/walk-in-party";

const newDiverContextForm = z.object({
  surface: z.string().optional(),
  tripId: z.string().optional(),
  waitlist: z.string().optional(),
  // The date request a booking door was opened from; carried back so the seat
  // that answers it can close it (third UX review, item 13).
  request: z.string().optional(),
  force: z.string().optional(),
});

const diverSchema = z
  .object({
    fullName: blankableDiverNameSchema,
    email: blankableDiverEmailSchema,
    phone: diverPhoneSchema,
  })
  .refine(({ fullName, email, phone }) => Boolean(fullName || email || phone));

/**
 * The new-diver form, from whichever door opened it: the roster's "Add diver",
 * or a seat flow (`surface` + `tripId`, and `waitlist` from a full trip) that
 * sent the staffer here to type someone the search did not find.
 *
 * A name that matches someone on file goes back to the page with the typed
 * values as `confirm*` params, so the staffer picks the existing diver or says
 * `force` and creates anyway. Every door's context is a claim from the form:
 * the seat and wait-list actions it hands on re-prove the trip against the
 * session's shop, and the tenant here is the session's own.
 */
export async function createDiverFormAction(formData: FormData) {
  const staff = await requireStaffSession();
  const activeDb = await getDb();
  const parsed = parseForm(diverSchema, formData);
  // Where the form was opened from; a context that does not read as strings
  // is no context, and the diver's own fields decide the rest.
  const opened = parseForm(newDiverContextForm, formData);
  const context = opened.ok ? opened.data : {};
  const activeSurface = (context.surface ?? null) as SeatSurfaceId | null;
  const activeTripId = context.tripId ? context.tripId : null;
  const activeWaitlist = context.waitlist === "true";
  const force = context.force === "true";

  const buildNewDiverUrl = (extraParams: Record<string, string>) => {
    const search = new URLSearchParams(extraParams);
    return `${shopPath(staff.user.shopSlug, "divers", "new")}?${search.toString()}`;
  };

  if (!parsed.ok) {
    const search: Record<string, string> = { notice: "invalid" };
    if (activeSurface) search.surface = activeSurface;
    if (activeTripId) search.tripId = activeTripId;
    if (activeWaitlist) search.waitlist = "true";
    redirect(buildNewDiverUrl(search));
  }

  // **A walk-in family** (fifth loop, item 9): party rows, or a first person
  // ticked "Under 18" or settled on the party's on-file prompt, send the whole
  // form to the party seating, which runs its own on-file check over every
  // name. A malformed party goes there too, to be refused rather than trimmed.
  const party = readWalkInParty(formData.entries());
  if (
    activeSurface === "walk-in" &&
    activeTripId &&
    (party.rows.length > 0 || party.first.minor || party.first.match !== undefined || party.invalid)
  ) {
    await seatWalkInPartyAction(staff.user.shopSlug, formData);
    return;
  }

  if (!force) {
    const matches = await findSimilarDivers(activeDb, staff.user.shopId, parsed.data.fullName);
    if (matches.length > 0) {
      const search: Record<string, string> = {
        confirmName: parsed.data.fullName,
      };
      if (parsed.data.email) search.confirmEmail = parsed.data.email;
      if (parsed.data.phone) search.confirmPhone = parsed.data.phone;
      if (activeSurface) search.surface = activeSurface;
      if (activeTripId) search.tripId = activeTripId;
      if (activeWaitlist) search.waitlist = "true";
      if (context.request) search.request = context.request;
      redirect(buildNewDiverUrl(search));
    }
  }
  // The form was accepted: whatever draft of it was kept is finished with.
  await discardFormDraft(activeDb, staff.user.shopId, staff.user.personId, "new_diver");

  if (activeSurface === "trip-guests" && activeWaitlist && activeTripId) {
    await addToWaitlistAction(staff.user.shopSlug, activeTripId, formData);
  } else if (
    activeSurface &&
    activeTripId &&
    Object.hasOwn(SEAT_SURFACES, activeSurface) &&
    (activeSurface === "trip-guests" ||
      activeSurface === "walk-in" ||
      activeSurface === "new-booking")
  ) {
    await seatNewDiverAction(activeSurface, staff.user.shopSlug, formData);
  } else {
    const diver = await createDiver(activeDb, {
      shopId: staff.user.shopId,
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      phone: parsed.data.phone,
    });
    if (!diver) {
      redirect(buildNewDiverUrl({ notice: "duplicate" }));
    }
    revalidateAndRedirect(
      shopPath(staff.user.shopSlug, "divers"),
      `${shopPath(staff.user.shopSlug, "divers", diver.id)}?edit=1`,
    );
  }
}
