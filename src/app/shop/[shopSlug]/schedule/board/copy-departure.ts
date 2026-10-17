import { z } from "zod";
import type { AppDb } from "@/db/client";
import { getTripCrewAssignments, setTripCrew } from "@/db/trips";

/** The board's "Copy" form: which departure, the new day and time, and whether its crew comes. */
export const duplicateSchema = z.object({
  tripId: z.uuid(),
  date: z.string(),
  startTime: z.string(),
  sameCrew: z.literal("on").optional(),
});

/**
 * **"Same crew"** (fifth-loop ideas, item 53): the source's crew, roles and
 * all, onto the copy through `setTripCrew`, so a clash or a course's
 * instructor rule refuses exactly as a hand assignment would. All or nothing:
 * the copy stands either way, and `false` tells the board to say the crew did
 * not come. True when the box was unticked or the source had no crew.
 */
export async function copyCrewIfAsked(
  db: AppDb,
  shopId: string,
  form: { tripId: string; sameCrew?: "on" },
  copyId: string,
  actorPersonId: string,
): Promise<boolean> {
  if (!form.sameCrew) return true;
  const crew = await getTripCrewAssignments(db, shopId, form.tripId);
  if (crew.length === 0) return true;
  return setTripCrew(db, shopId, copyId, crew, { actorPersonId });
}
