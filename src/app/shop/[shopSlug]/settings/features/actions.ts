"use server";

import { z } from "zod";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  setShopCrewScheduleEnabled,
  setShopDivingOptions,
  setShopFeature,
  setShopTaxEnabled,
} from "@/db/shops";
import { checkbox, formValue, readForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { paymentSettingsBlock, settingsBlock } from "../action-helpers";
import { type FeatureRowGate, isOptionalFeature, parseFeatureRow } from "./feature-rows";

const featureForm = z.object({
  row: formValue(),
  enabled: checkbox(),
  hasBoatDiving: checkbox(),
  hasShoreDiving: checkbox(),
  hasPoolDiving: checkbox(),
});

/** The row's own gate, re-checked against live roles; a refusal redirects. */
async function gateBlock(
  gate: FeatureRowGate,
  session: { user: { shopId: string; personId: string; shopSlug: string } },
): Promise<void> {
  if (gate === "settings") return settingsBlock(session);
  if (gate === "payments") return paymentSettingsBlock(session);
  const allowed = await canPersonManageStaffAccounts(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  if (allowed) return;
  const settings = shopPath(session.user.shopSlug, "settings");
  revalidateAndRedirect(settings, noticeUrl(settings, "not-authorized"));
}

/**
 * **Flips one switch on the Features page** (issue #2814). Every row posts here
 * with its own `row` id, so the row that changed comes back with its notice.
 * Only the switch moves: the divemaster target and every other value setting
 * is left as it was, and turning a feature off deletes nothing it wrote
 * (`shop-features.ts`). The one row with three switches, diving options,
 * refuses all three off: a shop needs at least one kind of departure.
 */
export async function saveFeatureAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "features");
  const form = readForm(featureForm, formData);
  const row = parseFeatureRow(form.row);
  // Only a hand-built post names no row; it gets the page back unchanged.
  if (!row) {
    revalidateAndRedirect(page, page);
    return;
  }
  await gateBlock(row.gate, session);

  const db = await getDb();
  const shopId = session.user.shopId;
  if (isOptionalFeature(row.id)) {
    await setShopFeature(db, shopId, row.id, form.enabled);
  } else if (row.id === "tax") {
    await setShopTaxEnabled(db, shopId, form.enabled);
  } else if (row.id === "crewSchedule") {
    await setShopCrewScheduleEnabled(db, shopId, form.enabled);
  } else {
    const { hasBoatDiving, hasShoreDiving, hasPoolDiving } = form;
    // Unticking all three would leave the builder with no mode to offer and trip
    // creation still defaulting to `boat`; the DB check refuses it too, and this
    // is the half that says so in words instead of raising.
    if (!hasBoatDiving && !hasShoreDiving && !hasPoolDiving) {
      revalidateAndRedirect(page, noticeUrl(page, "diving-options-none", { saved: row.id }));
      return;
    }
    await setShopDivingOptions(db, shopId, { hasBoatDiving, hasShoreDiving, hasPoolDiving });
  }

  revalidateAndRedirect(page, noticeUrl(page, "feature-saved", { saved: row.id }));
}
