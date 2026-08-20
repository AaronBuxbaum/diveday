"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import {
  checkOutGearReservation,
  createGearItem,
  releaseGearReservation,
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
 * The undo half of deleting a unit: recreate it from what the toast carried.
 * Service and rental history do not come back — deleting is for rows that
 * never should have existed, and the unit page says so before offering it.
 */
export async function restoreGearItemAction(formData: FormData) {
  const { session, gear } = await requireGearSurface();
  const parsed = unitFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));

  const outcome = await createGearItem(await getDb(), {
    shopId: session.user.shopId,
    ...parsed.data,
  });
  revalidateAndRedirect(gear, noticeUrl(gear, outcome.ok ? "restored" : outcome.reason));
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
