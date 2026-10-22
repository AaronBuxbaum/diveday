import { z } from "zod";
import type { AppDb } from "@/db/client";
import { attachDateLeadsToDeparture } from "@/db/leads";

/**
 * The schedule builder's hand-off from Requests: the checked `leadId` boxes
 * become departure rows on the new departure (ADR 20261017-one-lead-with-a-scope).
 * A malformed id is dropped rather than refused, because the ids are navigation
 * context and the writer reads each one inside the shop's own date leads.
 */
export async function attachRequestedLeads(
  db: AppDb,
  shopId: string,
  tripId: string,
  actorPersonId: string,
  formData: FormData,
): Promise<number> {
  const leadIds = formData
    .getAll("leadId")
    .filter((value): value is string => z.uuid().safeParse(value).success);
  return attachDateLeadsToDeparture(db, {
    shopId,
    tripId,
    leadIds,
    createdByPersonId: actorPersonId,
  });
}
