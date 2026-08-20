"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import {
  checkOutGearReservation,
  deleteGearItem,
  recordGearService,
  releaseGearReservation,
  returnGearReservation,
  setGearItemStatus,
  updateGearItem,
} from "@/db/gear";
import { GEAR_KIND_ORDER, type GearItemKind, type GearServiceKind } from "@/lib/gear";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const kindValues = GEAR_KIND_ORDER as [GearItemKind, ...GearItemKind[]];
const SERVICE_KINDS: [GearServiceKind, ...GearServiceKind[]] = [
  "service",
  "hydro_test",
  "visual_inspection",
  "o2_clean",
  "note",
];

const unitIdSchema = z.object({ gearItemId: z.uuid() });

async function requireUnitSurface(formData: FormData) {
  const session = await requireStaffSession();
  const gear = shopPath(session.user.shopSlug, "gear");
  const parsed = unitIdSchema.safeParse({ gearItemId: formData.get("gearItemId") });
  if (!parsed.success) revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));
  const unit = shopPath(session.user.shopSlug, "gear", parsed.data.gearItemId);
  /**
   * Where a refusal lands. A `not_found` goes to the register, not back to
   * the unit page — a unit that isn't there any more would render its own
   * 404 and swallow the worded notice.
   */
  const refusalPath = (reason: string) => (reason === "not_found" ? gear : unit);
  return { session, gear, unit, refusalPath, gearItemId: parsed.data.gearItemId };
}

const unitFormSchema = z.object({
  kind: z.enum(kindValues),
  label: z.string().trim().max(80),
  size: z.string().trim().max(40),
  serialNumber: z.string().trim().max(80),
  brandModel: z.string().trim().max(120),
  purchasedOn: z.string().trim().max(10),
});

export async function updateGearItemAction(formData: FormData) {
  const { session, unit, refusalPath, gearItemId } = await requireUnitSurface(formData);
  const parsed = unitFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(unit, noticeUrl(unit, "invalid"));

  const outcome = await updateGearItem(await getDb(), {
    shopId: session.user.shopId,
    gearItemId,
    ...parsed.data,
  });
  if (outcome.ok) revalidateAndRedirect(unit, noticeUrl(unit, "updated"));
  const to = refusalPath(outcome.reason);
  revalidateAndRedirect(to, noticeUrl(to, outcome.reason));
}

const statusSchema = z.object({
  status: z.enum(["in_service", "needs_service", "retired"]),
  serviceNote: z.string().trim().max(300).optional(),
});

export async function setGearItemStatusAction(formData: FormData) {
  const { session, unit, refusalPath, gearItemId } = await requireUnitSurface(formData);
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(unit, noticeUrl(unit, "invalid"));

  const outcome = await setGearItemStatus(await getDb(), {
    shopId: session.user.shopId,
    gearItemId,
    status: parsed.data.status,
    serviceNote: parsed.data.serviceNote,
  });
  if (outcome.ok) revalidateAndRedirect(unit, noticeUrl(unit, "updated"));
  const to = refusalPath(outcome.reason);
  revalidateAndRedirect(to, noticeUrl(to, outcome.reason));
}

const serviceSchema = z.object({
  kind: z.enum(SERVICE_KINDS),
  servicedOn: z.string().trim().min(1).max(10),
  nextDueOn: z.string().trim().max(10),
  nextDueDives: z.string().trim().max(4),
  note: z.string().trim().max(500),
});

export async function recordGearServiceAction(formData: FormData) {
  const { session, unit, refusalPath, gearItemId } = await requireUnitSurface(formData);
  const parsed = serviceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(unit, noticeUrl(unit, "invalid"));

  const outcome = await recordGearService(await getDb(), {
    shopId: session.user.shopId,
    gearItemId,
    kind: parsed.data.kind,
    servicedOn: parsed.data.servicedOn,
    nextDueOn: parsed.data.nextDueOn || undefined,
    nextDueDives: parsed.data.nextDueDives ? Number(parsed.data.nextDueDives) : undefined,
    note: parsed.data.note || undefined,
    recordedByPersonId: session.user.personId,
    returnToService: formData.get("returnToService") === "on",
  });
  if (outcome.ok) revalidateAndRedirect(unit, noticeUrl(unit, "service-logged"));
  const to = refusalPath(outcome.reason);
  revalidateAndRedirect(to, noticeUrl(to, outcome.reason));
}

/**
 * Deleting hands the row's fields to the register's undo toast; the unit's
 * history goes with it, which the page says out loud before offering this —
 * a unit that actually lived gets retired, not deleted.
 */
export async function deleteGearItemAction(formData: FormData) {
  const { session, gear, gearItemId } = await requireUnitSurface(formData);
  const outcome = await deleteGearItem(await getDb(), {
    shopId: session.user.shopId,
    gearItemId,
  });
  if (!outcome.ok) revalidateAndRedirect(gear, noticeUrl(gear, outcome.reason));
  revalidateAndRedirect(
    gear,
    noticeUrl(gear, "deleted", {
      undoKind: outcome.deleted.kind,
      undoLabel: outcome.deleted.label,
      undoSize: outcome.deleted.size ?? undefined,
      undoSerialNumber: outcome.deleted.serialNumber ?? undefined,
      undoBrandModel: outcome.deleted.brandModel ?? undefined,
      undoPurchasedOn: outcome.deleted.purchasedOn ?? undefined,
    }),
  );
}

const reservationSchema = z.object({ reservationId: z.uuid() });

async function reservationAction(
  formData: FormData,
  act: "release" | "check_out" | "return",
): Promise<never> {
  const { session, unit } = await requireUnitSurface(formData);
  const parsed = reservationSchema.safeParse({ reservationId: formData.get("reservationId") });
  if (!parsed.success) revalidateAndRedirect(unit, noticeUrl(unit, "invalid"));
  const db = await getDb();
  const input = { shopId: session.user.shopId, reservationId: parsed.data.reservationId };
  const outcome =
    act === "release"
      ? await releaseGearReservation(db, input)
      : act === "check_out"
        ? await checkOutGearReservation(db, input)
        : await returnGearReservation(db, input);
  const success = act === "release" ? "released" : act === "check_out" ? "checked-out" : "returned";
  // A missing reservation is not a missing unit: the unit page still exists
  // and renders the refusal, so this one keeps landing on `unit`.
  revalidateAndRedirect(unit, noticeUrl(unit, outcome.ok ? success : outcome.reason));
}

export async function releaseGearReservationAction(formData: FormData) {
  await reservationAction(formData, "release");
}

export async function checkOutGearReservationFromUnitAction(formData: FormData) {
  await reservationAction(formData, "check_out");
}

export async function returnGearReservationFromUnitAction(formData: FormData) {
  await reservationAction(formData, "return");
}
