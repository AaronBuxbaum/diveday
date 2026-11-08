import { getTripWithBooked } from "@/db/trips";
import { assistsAvailable } from "@/features/assists";
import { readUnsurePair } from "@/features/desk-assists";
import type { AppDb } from "../../db/client";
import { getDiverMergePreview } from "../../db/diver-merge";

/** Who may merge two records: the merge page's gate (`requireShopSurface`'s `allow`). */
export { canPersonMergeDiver } from "../../db/authz";

/**
 * **The merge preview page** (issue #2757): the preview, and — only when it
 * states no refusal of its own — the departure a refused merge collided on
 * (issue #2333; `conflictTripId` is the URL's, so it names only this shop's
 * own trip row) and whether a desk assist may weigh in on a pair the duplicate
 * check matched on the name alone. `null` when either record is not this shop's.
 */
export async function getDiverMergePage(
  db: AppDb,
  shopId: string,
  personId: string,
  survivorId: string,
  conflictTripId: string | null,
) {
  const preview = await getDiverMergePreview(db, shopId, personId, survivorId);
  if (!preview) return null;
  if (preview.refusal) return { preview, conflictTrip: null, canAssist: false };
  const conflictTrip = conflictTripId ? await getTripWithBooked(db, shopId, conflictTripId) : null;
  const canAssist =
    (await assistsAvailable(db, shopId)) &&
    (await readUnsurePair(db, shopId, personId, survivorId)) !== null;
  return { preview, conflictTrip, canAssist };
}
