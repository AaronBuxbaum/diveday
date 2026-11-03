import type { AppDb } from "@/db/client";
import { dateRequestPartyOnDeparture } from "@/db/date-request-offer-bookings";
import { type BookableDiver, getBookableDiver } from "@/db/divers";
import { type DateInterestRow, listDateInterestsByIds } from "@/db/interest-dates";
import { uuidParam } from "@/lib/uuid";

/**
 * The date request a departure's add band was opened from (`?add=1&request=`,
 * the Requests ledger's "Create booking" once a boat is picked, or a party
 * still being seated). The band's seats post its id, so the seat closes the
 * request when the party is complete.
 */
export type SeatRequest = {
  row: DateInterestRow;
  /**
   * The diver on file who asked, offered as the band's one match when nothing
   * was typed: picked by id, so a namesake is never the one seated. Null when
   * the request has no person, or that person is already on this boat.
   */
  candidate: BookableDiver | null;
  /** Seats the party already holds on this departure, and how many it asked for. */
  seated: number;
  partySize: number;
};

/**
 * Read `?request=` for the band. `null` when the URL names no request;
 * `"gone"` when it names one this shop has no open party for: another
 * tenant's id, a deleted or erased row, junk, a closed request, or a party
 * already seated. One answer for all of them, so the page cannot tell anyone
 * which ids exist, and a stale link costs the band its card, not the desk its
 * page.
 */
export async function readSeatRequest(
  db: AppDb,
  {
    shopId,
    tripId,
    request,
    typed,
  }: { shopId: string; tripId: string; request: string | undefined; typed: string },
): Promise<SeatRequest | null | "gone"> {
  if (request === undefined || request === "") return null;
  const id = uuidParam(request);
  if (!id) return "gone";
  const [row] = await listDateInterestsByIds(db, shopId, [id]);
  if (!row || row.closedAt) return "gone";
  const party = await dateRequestPartyOnDeparture(db, { shopId, tripId, requestId: row.id });
  const partySize = party?.partySize ?? Math.max(1, row.partySize ?? 1);
  const seated = party?.seated ?? 0;
  if (seated >= partySize) return "gone";
  const candidate =
    row.personId && typed === "" ? await getBookableDiver(db, shopId, tripId, row.personId) : null;
  return { row, candidate, seated, partySize };
}
