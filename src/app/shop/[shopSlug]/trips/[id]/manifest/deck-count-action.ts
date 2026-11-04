"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { recordDeckCount } from "@/db/deck-counts";
import { DECK_COUNT_MAX } from "@/lib/deck-count";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import type { DeckCountResult } from "./_components/DeckCount";
import type { ManifestActionContext } from "./actions";

const deckCountSchema = z.object({
  counted: z.coerce.number().int().min(0).max(DECK_COUNT_MAX),
});

/**
 * **Record the heads counted on deck at this checkpoint** (loop 5, row 1),
 * beside the manifest's other actions in `./actions.ts`. The count informs and
 * never gates, so the only answers are saved and "that did not save". The
 * checkpoint is the bound one, re-proved against the trip's plan inside the
 * write; the number is bounded here and again there. A context naming another
 * shop is a 404 (`requireShopSurface`), as on the page.
 */
export async function recordDeckCountAction(
  ctx: ManifestActionContext,
  _prev: DeckCountResult,
  formData: FormData,
): Promise<DeckCountResult> {
  const { session } = await requireShopSurface(ctx.shopSlug);
  const parsed = deckCountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false };
  try {
    const outcome = await recordDeckCount(await getDb(), {
      shopId: session.user.shopId,
      tripId: ctx.tripId,
      checkpoint: ctx.checkpoint,
      counted: parsed.data.counted,
      recordedByPersonId: session.user.personId,
    });
    if (!outcome.ok) return { ok: false };
  } catch {
    return { ok: false };
  }
  revalidatePath(shopPath(ctx.shopSlug, "trips", ctx.tripId, "manifest"));
  return { ok: true };
}
