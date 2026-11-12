import type { AppDb } from "@/db/client";
import { isLockWaitRefusal } from "@/db/lock-bounds";
import { setTripCrew } from "@/db/trips";
import { revalidateAndRedirect } from "@/features/navigation";

/** Do not invite an add retry after the departure was already committed. */
export async function assignCrewAfterCreate(
  db: AppDb,
  shopId: string,
  tripId: string,
  crew: string[],
  actorPersonId: string,
  board: string,
) {
  try {
    return await setTripCrew(db, shopId, tripId, crew, { actorPersonId });
  } catch (error) {
    if (isLockWaitRefusal(error)) revalidateAndRedirect(board, `${board}?builder=added-crew-busy`);
    throw error;
  }
}
