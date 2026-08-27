"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import {
  checkOutGearReservation,
  createGearItem,
  releaseGearReservation,
  restoreGearItem,
  returnGearReservation,
} from "@/db/gear";
import { GEAR_KIND_ORDER, type GearItemKind } from "@/lib/gear";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const kindValues = GEAR_KIND_ORDER as [GearItemKind, ...GearItemKind[]];

const unitFormSchema = z.object({
  kind: z.enum(kindValues),
  label: z.string().trim().max(80),
  size: z.string().trim().max(40),
  serialNumber: z.string().trim().max(80),
  brandModel: z.string().trim().max(120),
  purchasedOn: z.string().trim().max(10),
});

async function requireGearSurface() {
  const session = await requireStaffSession();
  return { session, gear: shopPath(session.user.shopSlug, "gear") };
}

export async function createGearItemAction(formData: FormData) {
  const { session, gear } = await requireGearSurface();
  const parsed = unitFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));

  const outcome = await createGearItem(await getDb(), {
    shopId: session.user.shopId,
    ...parsed.data,
  });
  revalidateAndRedirect(gear, noticeUrl(gear, outcome.ok ? "added" : outcome.reason));
}

/**
 * Put a deleted unit back — the undo toast's action, and the Deleted list's.
 * It clears the stamp on the row the shop already had, so the unit returns
 * with its service history and its rental windows attached.
 */
export async function restoreGearItemAction(formData: FormData) {
  const { session, gear } = await requireGearSurface();
  const parsed = z.object({ gearItemId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));

  const outcome = await restoreGearItem(await getDb(), {
    shopId: session.user.shopId,
    gearItemId: parsed.data.gearItemId,
  });
  // A tag collision on the way back is its own code: plain `duplicate-label`
  // is the add form's refusal and would render on that form's Tag field,
  // pointing a staffer at a box they never typed in.
  const refusal = outcome.ok
    ? "restored"
    : outcome.reason === "duplicate_label"
      ? "restore-duplicate-label"
      : outcome.reason;
  revalidateAndRedirect(gear, noticeUrl(gear, refusal));
}

const reservationActionSchema = z.object({ reservationId: z.uuid() });

export async function returnGearReservationAction(formData: FormData) {
  const { session, gear } = await requireGearSurface();
  const parsed = reservationActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));

  const outcome = await returnGearReservation(await getDb(), {
    shopId: session.user.shopId,
    reservationId: parsed.data.reservationId,
  });
  revalidateAndRedirect(gear, noticeUrl(gear, outcome.ok ? "returned" : outcome.reason));
}

export async function checkOutGearReservationAction(formData: FormData) {
  const { session, gear } = await requireGearSurface();
  const parsed = reservationActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));

  const outcome = await checkOutGearReservation(await getDb(), {
    shopId: session.user.shopId,
    reservationId: parsed.data.reservationId,
  });
  revalidateAndRedirect(gear, noticeUrl(gear, outcome.ok ? "checked-out" : outcome.reason));
}

/** The returns panel's close for a unit that never left the counter. */
export async function releaseGearReservationFromRegisterAction(formData: FormData) {
  const { session, gear } = await requireGearSurface();
  const parsed = reservationActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));

  const outcome = await releaseGearReservation(await getDb(), {
    shopId: session.user.shopId,
    reservationId: parsed.data.reservationId,
  });
  revalidateAndRedirect(gear, noticeUrl(gear, outcome.ok ? "released" : outcome.reason));
}
