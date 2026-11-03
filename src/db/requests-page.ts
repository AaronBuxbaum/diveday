import { groupDateRequests } from "@/lib/date-requests";
import { canPersonConfigureTrips } from "./authz";
import { listBoats } from "./boats";
import type { AppDb } from "./client";
import {
  countWaitingDateInterests,
  type DepartureOnTheBoard,
  listClosedDateInterests,
  listDeparturesOnDates,
  listOpenDateInterests,
} from "./interest-dates";

/**
 * The date requests page's question in one call. With date requests switched
 * off and no course inquiry left waiting, there is no page (`gone`).
 * Otherwise: one page of open interests grouped by day, the closed ones, the
 * fleet, whether this person may put a boat on a day (`canConfigureTrips`, the
 * builder's own gate), and the departures already on the board for those days.
 */
export async function getRequestsPage(
  db: AppDb,
  shop: { id: string; timezone: string; dateRequestsEnabled: boolean },
  personId: string,
  page: number,
) {
  if (!shop.dateRequestsEnabled && (await countWaitingDateInterests(db, shop.id)) === 0) {
    return { gone: true as const };
  }
  const [requestPage, handled, boats, addDeparture] = await Promise.all([
    listOpenDateInterests(db, shop.id, { page }),
    listClosedDateInterests(db, shop.id),
    listBoats(db, shop.id),
    canPersonConfigureTrips(db, shop.id, personId),
  ]);
  const { groups, undated } = groupDateRequests(requestPage.rows, (row) => row);
  const boardByDate = new Map<string, DepartureOnTheBoard[]>();
  for (const departure of await listDeparturesOnDates(
    db,
    shop.id,
    groups.map((group) => group.date),
    shop.timezone,
  )) {
    boardByDate.set(departure.date, [...(boardByDate.get(departure.date) ?? []), departure]);
  }
  return {
    gone: false as const,
    requestPage,
    handled,
    boats,
    can: { addDeparture },
    groups,
    undated,
    boardByDate,
  };
}
