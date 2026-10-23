"use server";

import { recordLastDive } from "@/db/last-dive";
import { nowDate } from "@/lib/clock";
import { revalidateAndRedirect } from "@/lib/navigation";
import { backTo, requireDiverActionContext } from "./action-helpers";

/**
 * Save or clear a diver's last dive anywhere (ADR 20261023-last-known-dive).
 * Any staff member on the record may: it is a fact somebody read off a
 * logbook at the counter, and it gates nothing. The rules are the writer's
 * (`recordLastDive`); this only routes its answer back to the row.
 */
export async function saveLastDiveAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-last-dive",
    "last-dive",
  );
  const { base, db, staff } = context;
  const raw = formData.get("lastDiveOn");
  const clear = formData.get("intent") === "clear";
  const on = clear ? null : typeof raw === "string" ? raw.trim() : "";
  if (on === "") revalidateAndRedirect(base, backTo(base, "last-dive-invalid", "last-dive"));
  const outcome = await recordLastDive(db, {
    shopId: staff.user.shopId,
    personId: context.personId,
    on,
    now: nowDate(),
  });
  const notice = outcome.ok
    ? clear
      ? "last-dive-cleared"
      : "last-dive-saved"
    : outcome.reason === "future"
      ? "last-dive-future"
      : outcome.reason === "before_known"
        ? "last-dive-before-known"
        : "last-dive-invalid";
  revalidateAndRedirect(base, backTo(base, notice, "last-dive"));
}
