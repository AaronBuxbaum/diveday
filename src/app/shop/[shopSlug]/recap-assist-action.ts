"use server";

import { getDb } from "@/db/client";
import { hasSentTripRecap } from "@/db/recap";
import { draftRecapLine } from "@/db/recap-assist";
import { requireStaffSession } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

/**
 * **recap**: "Draft it" on the recap highlight. Claude's line from the logged
 * sightings goes into the box for the crew to read, change and save; nothing
 * is written here, and a recap already sent takes no draft.
 */
export async function draftRecapLineAction(
  rawTripId: string,
): Promise<Record<string, string> | null> {
  const tripId = uuidParam(rawTripId);
  if (!tripId) return null;
  const staff = await requireStaffSession();
  const db = await getDb();
  if (await hasSentTripRecap(db, staff.user.shopId, tripId)) return null;
  const line = await draftRecapLine(db, staff.user.shopId, tripId);
  return line ? { recapShoutout: line } : null;
}
