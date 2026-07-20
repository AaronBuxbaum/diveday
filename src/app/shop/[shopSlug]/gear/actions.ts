"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  createGearItem,
  recordGearService,
  retireGear,
  returnGear,
  setGearServiceHold,
  updateGearItem,
} from "@/db/gear";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

const itemSchema = z.object({
  label: z.string().trim().min(2).max(80),
  type: z.enum(["bcd", "regulator", "wetsuit", "mask_fins", "weights", "tank"]),
  size: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
  serviceDueOn: z.string().optional(),
});

const serviceSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().min(3).max(500),
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nextDueOn: z.string().optional(),
});

/** Store calendar-only service dates at midday UTC so every US shop sees the selected day. */
function calendarDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function addAction(formData: FormData) {
  const staff = await requireStaffSession();
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
  const serviceDueAt = calendarDate(parsed.data.serviceDueOn);
  if (parsed.data.serviceDueOn && !serviceDueAt)
    redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
  await createGearItem(await getDb(), {
    shopId: staff.user.shopId,
    label: parsed.data.label,
    type: parsed.data.type,
    size: parsed.data.size,
    serviceDueAt: serviceDueAt ?? undefined,
    notes: parsed.data.notes,
  });
  revalidateAndRedirect(
    `/shop/${staff.user.shopSlug}/gear`,
    `/shop/${staff.user.shopSlug}/gear?notice=added`,
  );
}

export async function updateAction(formData: FormData) {
  const staff = await requireStaffSession();
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  const id = String(formData.get("id") ?? "");
  if (!id || !parsed.success) redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
  const serviceDueAt = calendarDate(parsed.data.serviceDueOn);
  if (parsed.data.serviceDueOn && !serviceDueAt)
    redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
  const updated = await updateGearItem(await getDb(), staff.user.shopId, id, {
    label: parsed.data.label,
    type: parsed.data.type,
    size: parsed.data.size,
    serviceDueAt: serviceDueAt ?? undefined,
    notes: parsed.data.notes,
  });
  revalidateAndRedirect(
    `/shop/${staff.user.shopSlug}/gear`,
    `/shop/${staff.user.shopSlug}/gear?notice=${updated ? "saved" : "invalid"}`,
  );
}

export async function holdAction(formData: FormData) {
  const staff = await requireStaffSession();
  const id = String(formData.get("id") ?? "");
  const held = formData.get("held") === "true";
  await setGearServiceHold(await getDb(), staff.user.shopId, id, held);
  revalidateAndRedirect(`/shop/${staff.user.shopSlug}/gear`);
}

export async function returnAction(formData: FormData) {
  const staff = await requireStaffSession();
  await returnGear(await getDb(), staff.user.shopId, String(formData.get("id") ?? ""));
  revalidateAndRedirect(
    `/shop/${staff.user.shopSlug}/gear`,
    `/shop/${staff.user.shopSlug}/gear?notice=returned`,
  );
}

export async function retireAction(formData: FormData) {
  const staff = await requireStaffSession();
  const retired = await retireGear(
    await getDb(),
    staff.user.shopId,
    String(formData.get("id") ?? ""),
  );
  revalidateAndRedirect(
    `/shop/${staff.user.shopSlug}/gear`,
    `/shop/${staff.user.shopSlug}/gear?notice=${retired ? "retired" : "invalid"}`,
  );
}

export async function serviceAction(formData: FormData) {
  const staff = await requireStaffSession();
  const parsed = serviceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
  const serviceCompletedAt = calendarDate(parsed.data.completedOn);
  const nextServiceDueAt = calendarDate(parsed.data.nextDueOn);
  if (!serviceCompletedAt || (parsed.data.nextDueOn && !nextServiceDueAt)) {
    redirect(`/shop/${staff.user.shopSlug}/gear?notice=invalid`);
  }
  const outcome = await recordGearService(await getDb(), {
    shopId: staff.user.shopId,
    gearItemId: parsed.data.id,
    recordedByPersonId: staff.user.personId,
    note: parsed.data.note,
    serviceCompletedAt,
    nextServiceDueAt,
  });
  revalidateAndRedirect(
    `/shop/${staff.user.shopSlug}/gear`,
    `/shop/${staff.user.shopSlug}/gear?notice=${outcome.ok ? "service" : "service-error"}`,
  );
}
