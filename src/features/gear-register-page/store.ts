import { countGearRentalHolders, listGearRentals } from "@/features/gear-rentals";
import type { AppDb } from "../../db/client";
import {
  countGearItemsByKind,
  gearRegisterGroups,
  listDeletedGearItems,
  listGearServiceDueRows,
} from "../../db/gear";
import type { CalendarDate } from "../../lib/calendar-date";
import type { GearItemKind } from "../../lib/gear";

/** The register's views: the live groups, or one that leaves them behind. */
export type GearRegisterView = "groups" | "deleted" | "service" | "rentals";

/**
 * The gear register's question in one call. Every view's count is read on
 * every request, because each chip states one; only the asked-for view takes
 * the requested page, and the rentals list is read only when asked for.
 */
export async function getGearRegisterPage(
  db: AppDb,
  shopId: string,
  options: {
    todayLocal: CalendarDate;
    kind?: GearItemKind;
    view: GearRegisterView;
    page: number;
    timezone: string;
  },
) {
  const { todayLocal, kind, view, page, timezone } = options;
  const [groups, deletedPage, countsByKind, serviceDue, rentalHolders, rentalsPage] =
    await Promise.all([
      gearRegisterGroups(db, shopId, { todayLocal, kind, page: view === "groups" ? page : 1 }),
      listDeletedGearItems(db, shopId, { page: view === "deleted" ? page : 1 }),
      countGearItemsByKind(db, shopId),
      listGearServiceDueRows(db, shopId, { todayLocal }),
      countGearRentalHolders(db, shopId),
      view === "rentals"
        ? listGearRentals(db, shopId, { todayLocal, page, timezone })
        : Promise.resolve(null),
    ]);
  return { groups, deletedPage, countsByKind, serviceDue, rentalHolders, rentalsPage };
}
