import type { AppDb } from "@/db/client";
import { countGearItems } from "@/db/gear";
import { listOpenCounterRentalsForPerson } from "@/db/gear-counter-rentals";
import { serviceReminderStates } from "@/db/work-order-follow-up";
import { listCustomerGearItems, listWorkOrdersForPerson } from "@/db/work-orders";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { customerGearDueDates } from "@/lib/work-order-follow-up";

/**
 * Everything the record's gear half shows, read by the page in its one batch so the
 * sections below it only render: the diver's own pieces and the bench's tickets on them
 * (ADR 20261008-gear-work-orders), which of those pieces already had a service reminder,
 * the counter rentals they have out, and whether the shop has a fleet to rent from at all.
 *
 * Shop-scoped from the session like every read on the page. A removed record is never
 * offered "Rent gear", so it skips the fleet count.
 */
export async function loadDiverGear(
  db: AppDb,
  shop: { id: string; timezone: string },
  personId: string,
  { removed }: { removed: boolean },
) {
  const [ownPieces, workOrders, counterRentals, fleetSize] = await Promise.all([
    listCustomerGearItems(db, shop.id, personId),
    listWorkOrdersForPerson(db, shop.id, personId, {
      todayLocal: calendarDateInTimezone(nowDate(), shop.timezone),
    }),
    listOpenCounterRentalsForPerson(db, shop.id, personId),
    removed ? 0 : countGearItems(db, shop.id),
  ]);
  const reminders = await serviceReminderStates(
    db,
    shop.id,
    ownPieces.filter((piece) => customerGearDueDates(piece).length > 0).map((piece) => piece.id),
  );
  return { ownPieces, workOrders, counterRentals, hasFleet: fleetSize > 0, reminders };
}
