import type { AppDb } from "@/db/client";
import { dateRequestPartyOnDeparture } from "@/db/date-request-offer-bookings";
import { type BookableDiver, getBookableDiver, isSeatedOnTrip } from "@/db/divers";
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
  /**
   * The asker on file already holds a seat on this departure. The card says so,
   * so an empty search is not read as "not on file" and a namesake is not seated
   * against the request (issue #3742).
   */
  askerAboard: boolean;
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
 * page. `"not_offered"` when the request is open but this departure was
 * never offered to it: every seat would be refused, so the band posts none.
 */
export async function readSeatRequest(
  db: AppDb,
  {
    shopId,
    tripId,
    request,
    typed,
  }: { shopId: string; tripId: string; request: string | undefined; typed: string },
): Promise<SeatRequest | null | "gone" | "not_offered"> {
  if (request === undefined || request === "") return null;
  const id = uuidParam(request);
  if (!id) return "gone";
  const [row] = await listDateInterestsByIds(db, shopId, [id]);
  if (!row || row.closedAt) return "gone";
  const party = await dateRequestPartyOnDeparture(db, { shopId, tripId, requestId: row.id });
  if (!party) return "not_offered";
  const { partySize, seated } = party;
  if (seated >= partySize) return "gone";
  const candidate =
    row.personId && typed === "" ? await getBookableDiver(db, shopId, tripId, row.personId) : null;
  const askerAboard = Boolean(
    row.personId && (await isSeatedOnTrip(db, shopId, tripId, row.personId)),
  );
  return { row, candidate, askerAboard, seated, partySize };
}
