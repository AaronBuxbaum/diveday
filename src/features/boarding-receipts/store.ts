import { asc, eq } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { isTransactionExecutor } from "@/db/query-helpers";
import { boardingObservations } from "@/db/schema";

/** A proposed receipt for a key already stored as an observation's own key. */
export type ProposedLegacyReceipt = {
  shopId: string;
  clientKey: string;
  observationId: string;
  bookingId: string;
  tripId: string;
  recordedByPersonId: string;
};

const MAX_INVENTORY_ROWS = 10_000;

/**
 * Compare one shop's stored original keys with proposed receipts. This is an
 * inventory, not a cutover authorization: the supplied receipts may be stale,
 * the caller has not proven a writer drain, and older writers could have
 * acknowledged joined keys without storing them at all. The report deliberately
 * contains counts only and never claims those unknown keys were recovered.
 * Matching covers only the selected legacy identifiers; it does not validate
 * receipt persistence, occurrence time, meeting identity or authorization.
 *
 * The caller must authorize access to the shop. No receipt is written and no
 * original day or generation is inferred from a booking that may have moved.
 */
export async function inspectLegacyBoardingKeys(
  tx: DbExecutor,
  shopId: string,
  proposed: readonly ProposedLegacyReceipt[],
) {
  if (!isTransactionExecutor(tx)) throw new Error("Boarding key inventory requires a transaction");
  if (proposed.length > MAX_INVENTORY_ROWS) throw new Error("Boarding key inventory is too large");
  const originals = await tx
    .select({
      clientKey: boardingObservations.clientKey,
      observationId: boardingObservations.id,
      bookingId: boardingObservations.bookingId,
      tripId: boardingObservations.tripId,
      recordedByPersonId: boardingObservations.recordedByPersonId,
    })
    .from(boardingObservations)
    .where(eq(boardingObservations.shopId, shopId))
    .orderBy(asc(boardingObservations.id))
    .limit(MAX_INVENTORY_ROWS + 1);
  if (originals.length > MAX_INVENTORY_ROWS) throw new Error("Boarding key inventory is too large");

  const byKey = new Map<string, ProposedLegacyReceipt[]>();
  for (const receipt of proposed) {
    if (receipt.shopId !== shopId) continue;
    const sameKey = byKey.get(receipt.clientKey) ?? [];
    sameKey.push(receipt);
    byKey.set(receipt.clientKey, sameKey);
  }
  const duplicateProposedKeys = [...byKey.values()].filter((rows) => rows.length > 1).length;
  let matchingSelectedFields = 0;
  let missing = 0;
  let conflicting = 0;
  for (const original of originals) {
    const receipts = byKey.get(original.clientKey);
    if (!receipts) {
      missing++;
      continue;
    }
    byKey.delete(original.clientKey);
    const [receipt] = receipts;
    if (
      receipts.length !== 1 ||
      !receipt ||
      receipt.observationId !== original.observationId ||
      receipt.bookingId !== original.bookingId ||
      receipt.tripId !== original.tripId ||
      receipt.recordedByPersonId !== original.recordedByPersonId
    ) {
      conflicting++;
      continue;
    }
    matchingSelectedFields++;
  }
  return {
    storedOriginalKeys: originals.length,
    matchingSelectedFields,
    missing,
    conflicting,
    duplicateProposedKeys,
    /** These may be joined receipts; this comparison cannot classify them. */
    unclassifiedReceiptKeys: byKey.size,
    originalMeetingAndGeneration: "unknown" as const,
    priorJoinedKeyCoverage: "unknown" as const,
    writerDrain: "unverified" as const,
    cutoverPermitted: false as const,
  };
}
