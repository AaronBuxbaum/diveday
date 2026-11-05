import { canDeleteDiver, canImportShopData, canMergeDiver } from "@/lib/authz";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb } from "./client";
import { listDiverMergeDuplicateIds } from "./diver-merge";
import { isDiverFilter, isDiverSort, listDiverSummaries } from "./divers";
import { rosterFacts } from "./roster-facts";

/**
 * **The divers roster in one call** (issue #2757).
 *
 * The reader's gates first, from one live staff-role read, because the view
 * the list runs depends on one of them: the removed view is the restore view,
 * so it takes delete's owner/manager gate here and not just on the chip — a
 * hand-typed `?filter=removed` lists nobody removed to a deckhand. Then the
 * page of divers beside the possible duplicates (merge's gate), then the four
 * roster facts, which take the ids the page just returned: all
 * `inArray`-bounded to this page rather than read over the whole roster.
 *
 * A non-numeric `page` reads as page 1; the query clamps it into range.
 */
export async function getDiversPage(
  db: AppDb,
  shop: { id: string; timezone: string },
  personId: string,
  input: { query: string; page: number; filter?: string; sort?: string; now: Date },
) {
  const { now } = input;
  const liveRoles = await loadActiveStaffRoles(db, shop.id, personId);
  const can = {
    delete: liveRoles !== null && canDeleteDiver(liveRoles),
    import: liveRoles !== null && canImportShopData(liveRoles),
    merge: liveRoles !== null && canMergeDiver(liveRoles),
  };
  const sort = isDiverSort(input.sort) ? input.sort : "name";
  const requested = isDiverFilter(input.filter) ? input.filter : "all";
  const filter = requested === "removed" && !can.delete ? "all" : requested;
  const [diverPage, possibleDuplicateIds] = await Promise.all([
    listDiverSummaries(db, shop.id, {
      query: input.query,
      page: input.page,
      filter,
      sort,
      // "Diving today" is the shop's own calendar day, not the server's.
      timeZone: shop.timezone,
      now,
    }),
    can.merge ? listDiverMergeDuplicateIds(db, shop.id) : Promise.resolve([]),
  ]);
  const facts = await rosterFacts(
    db,
    shop.id,
    diverPage.divers.map((diver) => diver.id),
    { now },
  );
  return {
    can,
    sort,
    filter,
    diverPage,
    duplicateIds: new Set<string>(possibleDuplicateIds),
    facts,
  };
}
