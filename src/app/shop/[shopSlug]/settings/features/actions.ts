"use server";

import {
  canPersonManagePaymentSettings,
  canPersonManageShopSettings,
  canPersonManageStaffAccounts,
} from "@/db/authz";
import { getDb } from "@/db/client";
import { setShopSwitches } from "@/db/shops";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import type { FeatureRowGate } from "./feature-rows";
import { planFeatureSave } from "./save-plan";

/**
 * **Saves the Features page, every switch at once** (issue #2814; one Save,
 * Aaron 2026-10-23). The page is shop settings, so a reader who may not manage
 * them is refused whole. Past that, each row keeps its own gate, re-checked
 * here against live roles: a row is written only when the page drew it and the
 * reader passes its gate now, and every other column is left as it was
 * (`planFeatureSave`). Only the switches move: the divemaster target and every
 * other value setting stay, and turning a feature off deletes nothing it wrote
 * (`shop-features.ts`). All three kinds of diving off refuses the whole save.
 */
export async function saveFeaturesAction(formData: FormData) {
  const session = await requireStaffSession();
  const { shopId, personId, shopSlug } = session.user;
  const page = shopPath(shopSlug, "settings", "features");
  const db = await getDb();

  if (!(await canPersonManageShopSettings(db, shopId, personId))) {
    const settings = shopPath(shopSlug, "settings");
    revalidateAndRedirect(settings, noticeUrl(settings, "not-authorized"));
  }
  const gates = new Set<FeatureRowGate>(["settings"]);
  if (await canPersonManagePaymentSettings(db, shopId, personId)) gates.add("payments");
  if (await canPersonManageStaffAccounts(db, shopId, personId)) gates.add("team");

  const plan = planFeatureSave(formData, gates);
  // Only a hand-built post names no row; it gets the page back unchanged.
  if (plan.kind === "nothing") revalidateAndRedirect(page, page);
  if (plan.kind === "diving-options-none") {
    revalidateAndRedirect(page, noticeUrl(page, "diving-options-none"));
  }
  await setShopSwitches(db, shopId, plan.switches);
  revalidateAndRedirect(page, noticeUrl(page, "feature-saved"));
}
