import { z } from "zod";
import type { AppDb } from "@/db/client";
import { attachDateInterestsToDeparture } from "@/db/interests";

/**
 * The schedule builder's hand-off from Requests: the checked `interestId` boxes
 * become departure rows on the new departure (ADR 20261017-one-interest-with-a-scope).
 * A malformed id is dropped rather than refused, because the ids are navigation
 * context and the writer reads each one inside the shop's own date interests.
 */
export async function attachRequestedInterests(
  db: AppDb,
  shopId: string,
  tripId: string,
  actorPersonId: string,
  formData: FormData,
): Promise<number> {
  const interestIds = formData
    .getAll("interestId")
    .filter((value): value is string => z.uuid().safeParse(value).success);
  return attachDateInterestsToDeparture(db, {
    shopId,
    tripId,
    interestIds,
    createdByPersonId: actorPersonId,
  });
}
