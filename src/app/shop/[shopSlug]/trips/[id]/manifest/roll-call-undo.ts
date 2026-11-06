import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { RollCallResult } from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { RETRACTION_SUPERSEDED } from "@/lib/roll-call";

/**
 * The stored event a roll-call undo takes back (#3995): the row id the
 * manifest rendered. The write applies the undo only while that event is still
 * the mark shown, so a double tap or a stale screen cannot take back another.
 */
export const retractsEventIdSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase())
  .optional();

/**
 * A roll-call refusal as the tap reads it. `retraction_superseded` is the one
 * a crew member can act on: the mark they meant to take back changed under
 * them, so the manifest at `path` refreshes to what stands and says so.
 */
export function supersededOr(path: string, reason: string): RollCallResult {
  if (reason !== RETRACTION_SUPERSEDED) return { ok: false, reason: "error" };
  revalidatePath(path);
  return { ok: false, reason: "superseded" };
}
