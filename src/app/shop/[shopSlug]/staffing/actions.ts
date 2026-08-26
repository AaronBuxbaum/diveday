"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  createStaffCredential,
  deleteStaffCredential,
  reviewStaffCredential,
} from "@/db/staff-credentials";
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

const credentialSchema = z.object({
  personId: z.string().uuid(),
  kind: z.enum([
    "instructor_rating",
    "divemaster_rating",
    "liability_insurance",
    "first_aid_cpr",
    "oxygen_provider",
    "captains_licence",
    "other",
  ]),
  name: z.string().trim().min(1).max(160),
  issuingBody: z.string().trim().max(160),
  identifier: z.string().trim().max(120),
  issuedAt: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/),
  renewsAt: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/),
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

export async function saveStaffCredentialAction(formData: FormData) {
  const session = await requireStaffingManager();
  const path = shopPath(session.user.shopSlug, "staffing");
  const parsed = credentialSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(path, "credential-invalid"));
  const row = await createStaffCredential(await getDb(), {
    shopId: session.user.shopId,
    personId: parsed.data.personId,
    kind: parsed.data.kind,
    name: parsed.data.name,
    issuingBody: parsed.data.issuingBody || null,
    identifier: parsed.data.identifier || null,
    issuedAt: parsed.data.issuedAt || null,
    renewsAt: parsed.data.renewsAt || null,
  });
  revalidateAndRedirect(path, noticeUrl(path, row ? "credential-saved" : "credential-invalid"));
}

export async function reviewStaffCredentialAction(formData: FormData) {
  const session = await requireStaffingManager();
  const path = shopPath(session.user.shopSlug, "staffing");
  const id = z.string().uuid().safeParse(formData.get("credentialId"));
  const status = z.enum(["pending", "verified"]).safeParse(formData.get("status"));
  if (!id.success || !status.success) redirect(noticeUrl(path, "credential-invalid"));
  const row = await reviewStaffCredential(await getDb(), {
    shopId: session.user.shopId,
    credentialId: id.data,
    status: status.data,
    reviewNote:
      String(formData.get("reviewNote") ?? "")
        .trim()
        .slice(0, 300) || null,
    reviewedByPersonId: session.user.personId,
  });
  revalidateAndRedirect(path, noticeUrl(path, row ? "credential-reviewed" : "credential-invalid"));
}

export async function deleteStaffCredentialAction(formData: FormData) {
  const session = await requireStaffingManager();
  const path = shopPath(session.user.shopSlug, "staffing");
  const id = z.string().uuid().safeParse(formData.get("credentialId"));
  if (!id.success) redirect(noticeUrl(path, "credential-invalid"));
  const deleted = await deleteStaffCredential(
    await getDb(),
    session.user.shopId,
    id.data,
    session.user.personId,
  );
  revalidateAndRedirect(
    path,
    noticeUrl(path, deleted ? "credential-deleted" : "credential-invalid"),
  );
}
