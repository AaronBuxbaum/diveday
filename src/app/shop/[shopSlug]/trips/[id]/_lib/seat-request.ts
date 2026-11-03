import type { AppDb } from "@/db/client";
import { type BookableDiver, getBookableDiver } from "@/db/divers";
import { type DateInterestRow, listDateInterestsByIds } from "@/db/interest-dates";
import { uuidParam } from "@/lib/uuid";

/**
 * The date request a departure's add band was opened from (`?add=1&request=`,
 * the Requests ledger's "Create booking" once a boat is picked, or a party
 * still being seated). Every seat the band makes posts its id, so the seat
 * closes the request when the party is complete.
 */
export type SeatRequest = {
  row: DateInterestRow;
  /**
   * The diver on file who asked, offered as the band's one match when nothing
   * was typed: picked by id, so a namesake is never the one seated. Null when
   * the request has no person, or that person is already on this boat.
   */
  candidate: BookableDiver | null;
};

/**
 * Read `?request=` for the band. `null` when the URL names no request;
 * `"missing"` when it names one this shop does not have (another tenant's id,
 * a deleted row, or junk), which the page answers with `notFound()`: a link
 * that names a request and quietly drops it would seat the diver without
 * closing what they asked for.
 */
export async function readSeatRequest(
  db: AppDb,
  {
    shopId,
    tripId,
    request,
    typed,
  }: { shopId: string; tripId: string; request: string | undefined; typed: string },
): Promise<SeatRequest | null | "missing"> {
  if (request === undefined || request === "") return null;
  const id = uuidParam(request);
  if (!id) return "missing";
  const [row] = await listDateInterestsByIds(db, shopId, [id]);
  if (!row) return "missing";
  const candidate =
    row.personId && typed === "" ? await getBookableDiver(db, shopId, tripId, row.personId) : null;
  return { row, candidate };
}
