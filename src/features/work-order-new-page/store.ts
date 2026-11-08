import { getDiverProfile } from "@/features/divers";
import {
  listBenchUnits,
  listCustomerGearItems,
  searchWorkOrderCustomers,
} from "@/features/work-orders";
import type { AppDb } from "../../db/client";
import { listStaff } from "../../db/trips";

/**
 * The new work order panel's question in one call. A ticket's subject is a
 * customer (`personId`) or a bench unit (`unitId`), never both: both named, or
 * a name that is not this shop's diver or bench unit, is no subject, and the
 * panel asks whose gear it is again. With a customer it reads their profile
 * and gear; without one, the bench and, with no unit chosen either, the
 * customer search.
 */
export async function getWorkOrderNewPage(
  db: AppDb,
  shopId: string,
  subject: { personId?: string | null; unitId?: string | null; query: string },
) {
  const { personId: askedPerson, unitId: askedUnit, query } = subject;
  const both = Boolean(askedPerson && askedUnit);
  const [profile, staff, allUnits] = await Promise.all([
    askedPerson && !both ? getDiverProfile(db, shopId, askedPerson) : null,
    listStaff(db, shopId),
    listBenchUnits(db, shopId),
  ]);
  const customer = profile ?? null;
  const personId = customer ? (askedPerson ?? undefined) : undefined;
  const chosenUnit = askedUnit && !both ? allUnits.find((row) => row.id === askedUnit) : undefined;
  const [pieces, candidates] = await Promise.all([
    personId ? listCustomerGearItems(db, shopId, personId) : [],
    personId || chosenUnit ? [] : searchWorkOrderCustomers(db, shopId, query),
  ]);
  return {
    customer,
    personId,
    pieces,
    candidates,
    units: personId ? [] : allUnits,
    staff,
    chosenUnit,
  };
}
