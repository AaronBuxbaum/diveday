import type { AppDb } from "./client";
import { getDiverProfile } from "./divers";
import { listStaff } from "./trips";
import { listBenchUnits, listCustomerGearItems, searchWorkOrderCustomers } from "./work-orders";

/**
 * The new work order page's question in one call. A ticket's subject is a
 * customer (`personId`) or a bench unit (`unitId`), never both: with a
 * customer the page reads their profile and gear, without one it reads the
 * bench and, with neither, the customer search. `chosenUnit` is the named
 * bench unit, or undefined when it names none.
 */
export async function getWorkOrderNewPage(
  db: AppDb,
  shopId: string,
  subject: { personId?: string | null; unitId?: string | null; query: string },
) {
  const { personId, unitId, query } = subject;
  const [customer, pieces, candidates, units, staff] = await Promise.all([
    personId ? getDiverProfile(db, shopId, personId) : null,
    personId ? listCustomerGearItems(db, shopId, personId) : [],
    personId || unitId ? [] : searchWorkOrderCustomers(db, shopId, query),
    personId ? [] : listBenchUnits(db, shopId),
    listStaff(db, shopId),
  ]);
  const unit = unitId ? units.find((row) => row.id === unitId) : undefined;
  const chosenUnit =
    unitId && !unit ? (await listBenchUnits(db, shopId)).find((row) => row.id === unitId) : unit;
  return { customer, pieces, candidates, units, staff, chosenUnit };
}
