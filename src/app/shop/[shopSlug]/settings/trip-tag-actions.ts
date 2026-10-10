"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { createTripLens, deleteTripLens, renameTripLens } from "@/db/trip-lenses";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { LENS_NAME_MAX } from "@/lib/trip-lenses";
import { uuidParam } from "@/lib/uuid";
import { settingsBlock } from "./action-helpers";

/**
 * **The shop's trip tags** — ADR
 * 20260904-reef-all-the-way-down, decision 2 (issue #1162).
 *
 * The same three actions the fleet row above has, for the same reason: this is
 * a shop-owned vocabulary with a soft delete, and its notice codes ride the
 * same `?saved=` section so the row that changed comes back open.
 */
export async function createTripLensAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "trip-tags");
  await settingsBlock(session);

  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, LENS_NAME_MAX);
  if (!name) {
    redirect(noticeUrl(page, "lens-invalid"));
  }

  const db = await getDb();
  await createTripLens(db, session.user.shopId, name);

  revalidateAndRedirect(page, noticeUrl(page, "lens-created"));
}

/** Corrects the word a shop wrote. The slug it was published under does not move. */
export async function updateTripLensAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "trip-tags");
  await settingsBlock(session);

  const rawLensId = formData.get("lensId");
  const lensId = typeof rawLensId === "string" ? uuidParam(rawLensId) : null;
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, LENS_NAME_MAX);
  if (!lensId || !name) {
    redirect(noticeUrl(page, "lens-invalid"));
  }

  const db = await getDb();
  await renameTripLens(db, session.user.shopId, lensId, name);

  revalidateAndRedirect(page, noticeUrl(page, "lens-updated"));
}

/** Stamps the word and leaves every departure that wore it saying so. */
export async function deleteTripLensAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "trip-tags");
  await settingsBlock(session);

  const rawLensId = formData.get("lensId");
  const lensId = typeof rawLensId === "string" ? uuidParam(rawLensId) : null;
  if (!lensId) {
    redirect(noticeUrl(page, "lens-invalid"));
  }

  const db = await getDb();
  await deleteTripLens(db, session.user.shopId, lensId);

  revalidateAndRedirect(page, noticeUrl(page, "lens-deleted"));
}
