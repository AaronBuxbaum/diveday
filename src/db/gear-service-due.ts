/**
 * Gear: which units are due for service, and when. Imported through the
 * `./gear` barrel.
 */
import { and, asc, eq, notInArray } from "drizzle-orm";
import { SAFETY_KIT_KINDS } from "@/lib/boat-safety";
import type { CalendarDate } from "@/lib/calendar-date";
import {
  type GearItemKind,
  type GearServiceState,
  gearServiceIsDue,
  gearServiceState,
  pickDisplayReservation,
} from "@/lib/gear";
import type { AppDb } from "./client";
import { dueKey, type GearRegisterRow, listOpenReservations } from "./gear-register";
import { latestServiceClocks } from "./gear-service";
import { liveGearItem } from "./gear-shared";
import { gearItems } from "./schema";

/**
 * **The fleet-wide answer to "what wants the bench?"** — every live unit the
 * register would say a service sentence about, soonest deadline first,
 * wherever the unit currently is.
 *
 * This is the one reading on the register that no group owns. Out, Overdue and
 * On the wall each fold a fact the retired stat tiles used to duplicate; the
 * service tile duplicated nothing, and deleting it with the other two would
 * have left the register able to answer "what is due for service?" only for
 * the fifty units on the current wall page — while the page's own description
 * still promised the answer. Today's queue keeps the urgent half (six days,
 * `src/db/today.ts`); this keeps the month, which is where a tank's visual
 * inspection and hydro — clocks a fill station enforces — are caught before
 * they strand a boat.
 *
 * Fleet-wide and unpaged on purpose. It is bounded by the work rather than by
 * the fleet, exactly like {@link gearRegisterGroups}' out and overdue lists,
 * and a service run hidden on page 3 is the failure this reader exists to
 * undo. It ignores the kind chips for the same reason the deleted list does:
 * it is its own view of the register, and the chip that opens it states the
 * whole count it will show.
 */
export async function listGearServiceDueRows(
  db: AppDb,
  shopId: string,
  options: { todayLocal: CalendarDate },
): Promise<GearRegisterRow[]> {
  const items = await db
    .select()
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), liveGearItem()))
    .orderBy(asc(gearItems.kind), asc(gearItems.label));
  if (items.length === 0) return [];

  // Clocks over the whole fleet, because the question is a fleet question —
  // but reservations only for the handful that came back due. The register
  // runs this on every request to state the chip's count, and reading every
  // open window to decide a number that does not depend on one would be a
  // query the page pays for and never uses.
  const clocksByItem = await latestServiceClocks(
    db,
    shopId,
    items.map((item) => item.id),
  );
  const due = items
    .map((item) => ({
      item,
      serviceState: gearServiceState(clocksByItem.get(item.id) ?? [], options.todayLocal),
    }))
    .filter((row) => gearServiceIsDue(row.item, row.serviceState));
  if (due.length === 0) return [];

  const openReservations = await listOpenReservations(
    db,
    shopId,
    due.map((row) => row.item.id),
  );
  return due
    .map((row) => ({
      ...row,
      reservation: pickDisplayReservation(
        openReservations.get(row.item.id) ?? [],
        options.todayLocal,
      ),
    }))
    .sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || a.item.label.localeCompare(b.item.label));
}

export type GearServiceDueRow = {
  gearItemId: string;
  kind: GearItemKind;
  label: string;
  state: GearServiceState;
};

/**
 * Working units whose most urgent clock is overdue or runs out within
 * `withinDays`. A deleted unit keeps its history and stops asking for care.
 * Safety kit is left out: Today's boat rows speak for it.
 */
export async function listGearServiceDue(
  db: AppDb,
  shopId: string,
  todayLocal: CalendarDate,
  withinDays: number,
): Promise<GearServiceDueRow[]> {
  const items = await db
    .select({ id: gearItems.id, kind: gearItems.kind, label: gearItems.label })
    .from(gearItems)
    .where(
      and(
        eq(gearItems.shopId, shopId),
        liveGearItem(),
        // The boat's own emergency kit is Today's boat rows' to say
        // (`todayBoatSafety`, src/db/boat-safety.ts): on a departure sailing
        // today, or as the owner's errand once it lapses. A bench-clock row
        // too would put one dead AED on Today twice.
        notInArray(gearItems.kind, [...SAFETY_KIT_KINDS]),
      ),
    )
    .orderBy(asc(gearItems.kind), asc(gearItems.label));
  if (items.length === 0) return [];

  const clocksByItem = await latestServiceClocks(
    db,
    shopId,
    items.map((item) => item.id),
  );
  const due: GearServiceDueRow[] = [];
  for (const item of items) {
    const state = gearServiceState(clocksByItem.get(item.id) ?? [], todayLocal);
    if (state.state === "overdue" || (state.state === "due_soon" && state.daysLeft <= withinDays)) {
      due.push({ gearItemId: item.id, kind: item.kind, label: item.label, state });
    }
  }
  due.sort((a, b) => {
    const dueA = a.state.state === "no_clock" ? "" : a.state.nextDueOn;
    const dueB = b.state.state === "no_clock" ? "" : b.state.nextDueOn;
    return dueA.localeCompare(dueB) || a.label.localeCompare(b.label);
  });
  return due;
}
