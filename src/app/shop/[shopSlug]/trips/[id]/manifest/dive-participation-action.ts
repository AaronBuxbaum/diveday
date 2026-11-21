"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireShopSurface } from "@/features/accounts/session";
import { recordDiveParticipation } from "@/features/after-the-dive/dive-participation";
import { DIVE_PARTICIPATIONS } from "@/lib/dive-participation";
import { rollCallCheckpointOrdinal } from "@/lib/roll-call";
import { shopPath } from "@/lib/staff-notices";
import type { ManifestActionContext } from "./actions";

const diveParticipationSchema = z.object({
  bookingId: z.string().uuid(),
  participation: z.enum(DIVE_PARTICIPATIONS),
});

/**
 * One seat's note on the dive this checkpoint follows (issue #4307): dived,
 * sat out, or unknown again. Writes nothing to the roll call and moves no
 * count; the write re-proves the staffer, the departure, the dive and the seat
 * against the session's shop. No redirect: the sheet settles in place.
 */
export async function recordDiveParticipationAction(
  ctx: ManifestActionContext,
  bookingId: string,
  participation: string,
): Promise<{ ok: boolean }> {
  const staff = (await requireShopSurface(ctx.shopSlug)).session;
  const parsed = diveParticipationSchema.safeParse({ bookingId, participation });
  if (!parsed.success || ctx.checkpoint === "departure") return { ok: false };
  try {
    const outcome = await recordDiveParticipation(await getDb(), {
      shopId: staff.user.shopId,
      tripId: ctx.tripId,
      bookingId: parsed.data.bookingId,
      diveNumber: rollCallCheckpointOrdinal(ctx.checkpoint),
      participation: parsed.data.participation,
      recordedByPersonId: staff.user.personId,
    });
    if (!outcome.ok) return { ok: false };
  } catch {
    return { ok: false };
  }
  revalidatePath(shopPath(ctx.shopSlug, "trips", ctx.tripId, "manifest"));
  return { ok: true };
}
