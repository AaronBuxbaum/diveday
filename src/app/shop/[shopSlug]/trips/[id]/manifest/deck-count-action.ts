"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireShopSurface } from "@/features/accounts/session";
import { parseDeckCount, recordDeckCount } from "@/features/boarding/deck-counts";
import { shopPath } from "@/lib/staff-notices";
import type { ManifestActionContext } from "./actions";

/** A deck count's answer: saved, a number the crew can fix, or "try again". */
export type DeckCountResult = { ok: true } | { ok: false; reason: "invalid" | "error" } | null;

/**
 * **The count on deck** (issue #4248): the heads the captain counted at this
 * checkpoint, crew included. Recorded and compared, never a gate: it closes,
 * opens and blocks nothing, and the per-person roll call stays the head count.
 * The write re-proves the staffer, the departure and the checkpoint.
 */
export async function recordDeckCountAction(
  ctx: ManifestActionContext,
  _prev: DeckCountResult,
  formData: FormData,
): Promise<DeckCountResult> {
  const staff = (await requireShopSurface(ctx.shopSlug)).session;
  const counted = parseDeckCount(formData.get("counted"));
  if (counted === null) return { ok: false, reason: "invalid" };
  try {
    const outcome = await recordDeckCount(await getDb(), {
      shopId: staff.user.shopId,
      tripId: ctx.tripId,
      checkpoint: ctx.checkpoint,
      counted,
      recordedByPersonId: staff.user.personId,
    });
    if (!outcome.ok) {
      return { ok: false, reason: outcome.reason === "count_invalid" ? "invalid" : "error" };
    }
  } catch {
    return { ok: false, reason: "error" };
  }
  revalidatePath(shopPath(ctx.shopSlug, "trips", ctx.tripId, "manifest"));
  return { ok: true };
}
