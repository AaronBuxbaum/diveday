import { z } from "zod";
import type { AppDb } from "@/db/client";
import { attachDateInterestsToDeparture, dateInterestsAskForCharter } from "@/db/interests";

/**
 * The schedule builder's hand-off from Requests: the checked `interestId` boxes
 * become departure rows on the new departure (ADR 20261017-one-interest-with-a-scope).
 * A malformed id is dropped rather than refused, because the ids are navigation
 * context and the writer reads each one inside the shop's own date interests.
 */
function requestedInterestIds(formData: FormData): string[] {
  return formData
    .getAll("interestId")
    .filter((value): value is string => z.uuid().safeParse(value).success);
}

/**
 * A departure answering a private charter request is private (loop 5, row
 * 11): the boat is the group's, so it never goes on the public schedule.
 */
export async function requestsAskForCharter(
  db: AppDb,
  shopId: string,
  formData: FormData,
): Promise<boolean> {
  return dateInterestsAskForCharter(db, shopId, requestedInterestIds(formData));
}

export async function attachRequestedInterests(
  db: AppDb,
  shopId: string,
  tripId: string,
  actorPersonId: string,
  formData: FormData,
): Promise<number> {
  return attachDateInterestsToDeparture(db, {
    shopId,
    tripId,
    interestIds: requestedInterestIds(formData),
    createdByPersonId: actorPersonId,
  });
}
