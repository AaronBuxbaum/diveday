"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { createStaffShift, deleteStaffShift } from "@/db/staffing";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

const shiftSchema = z.object({
  personId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  note: z.string().trim().max(120),
});

async function requireStaffingManager() {
  const session = await requireStaffSession();
  const allowed = await canPersonManageStaffAccounts(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  if (!allowed) redirect(noticeUrl(shopPath(session.user.shopSlug, "staffing"), "not-authorized"));
  return session;
}

export async function createShiftAction(formData: FormData) {
  const session = await requireStaffingManager();
  const path = shopPath(session.user.shopSlug, "staffing");
  const parsed = shiftSchema.safeParse(Object.fromEntries(formData));
  const shop = await getShopById(await getDb(), session.user.shopId);
  if (!parsed.success || !shop) redirect(noticeUrl(path, "invalid"));
  const starts = parseWallTime(parsed.data.date, parsed.data.startTime);
  const ends = parseWallTime(parsed.data.date, parsed.data.endTime);
  if (!starts || !ends) redirect(noticeUrl(path, "invalid"));
  const result = await createStaffShift(await getDb(), {
    shopId: session.user.shopId,
    personId: parsed.data.personId,
    startsAt: wallTimeToUtc(starts, shop.timezone),
    endsAt: wallTimeToUtc(ends, shop.timezone),
    note: parsed.data.note,
    createdByPersonId: session.user.personId,
  });
  // `result.reason` is a domain code in the domain's own casing (`staff_not_found`);
  // `noticeUrl` encodes it and normalises it to the one spelling the page's
  // notice map holds, so it is no longer interpolated raw.
  const notice = result.ok ? "shift-saved" : result.reason;
  revalidateAndRedirect(path, noticeUrl(path, notice));
}

export async function deleteShiftAction(formData: FormData) {
  const session = await requireStaffingManager();
  const path = shopPath(session.user.shopSlug, "staffing");
  const shiftId = String(formData.get("shiftId") ?? "");
  if (!z.string().uuid().safeParse(shiftId).success) redirect(noticeUrl(path, "invalid"));
  const deleted = await deleteStaffShift(await getDb(), session.user.shopId, shiftId);
  revalidateAndRedirect(path, noticeUrl(path, deleted ? "shift-deleted" : "invalid"));
}
