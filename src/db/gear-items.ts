/**
 * Gear: the units themselves — create, edit, status, soft delete, restore and
 * count. Imported through the `./gear` barrel.
 */
import { and, count, eq, gte, isNotNull, isNull, or } from "drizzle-orm";
import { isSafetyKitKind } from "@/lib/boat-safety";
import { type CalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { GearItemKind, GearItemStatus } from "@/lib/gear";
import type { AppDb, DbExecutor } from "./client";
import { liveGearItem, openGearReservation, optional } from "./gear-shared";
import { violatesUniqueIndex } from "./query-helpers";
import { boats, type GearItem, gearItems, gearReservations } from "./schema";

export type GearItemInput = {
  shopId: string;
  kind: GearItemKind;
  label: string;
  size?: string;
  serialNumber?: string;
  brandModel?: string;
  purchasedOn?: string;
  /**
   * The hull a piece of safety kit lives aboard. `undefined` leaves an edited
   * unit's assignment as it was; `null` (or "") brings it ashore. Ignored and
   * cleared for any kind that is not safety kit (`isSafetyKitKind`).
   */
  aboardBoatId?: string | null;
};

export type CreateGearItemOutcome =
  | { ok: true; item: GearItem }
  | { ok: false; reason: "empty_label" | "duplicate_label" | "invalid_date" | "invalid_boat" };

/**
 * What to write to `aboard_boat_id`: `undefined` to leave it, `null` to clear
 * it, or a hull id this shop still runs. A boat id from another shop or a
 * deleted hull is `"invalid"` — a forged or stale select must not hang a unit
 * on a vessel the shop cannot see.
 */
async function aboardBoatFor(
  db: DbExecutor,
  shopId: string,
  kind: GearItemKind,
  aboardBoatId: string | null | undefined,
): Promise<string | null | undefined | "invalid"> {
  if (!isSafetyKitKind(kind)) return null;
  if (aboardBoatId === undefined) return undefined;
  if (!aboardBoatId) return null;
  const [boat] = await db
    .select({ id: boats.id })
    .from(boats)
    .where(and(eq(boats.id, aboardBoatId), eq(boats.shopId, shopId), isNull(boats.deletedAt)))
    .limit(1);
  return boat ? boat.id : "invalid";
}

/**
 * Add one unit to the register. The label is the shop's own tag and must be
 * unique per shop — the database's unique index is the truth, and losing that
 * race reads back as the same worded refusal a plain duplicate gets.
 */
export async function createGearItem(
  db: AppDb,
  input: GearItemInput,
): Promise<CreateGearItemOutcome> {
  const label = input.label.trim();
  if (!label) return { ok: false, reason: "empty_label" };
  const purchasedOn = optional(input.purchasedOn);
  if (purchasedOn && !isValidCalendarDate(purchasedOn))
    return { ok: false, reason: "invalid_date" };
  const aboardBoatId = await aboardBoatFor(db, input.shopId, input.kind, input.aboardBoatId);
  if (aboardBoatId === "invalid") return { ok: false, reason: "invalid_boat" };
  try {
    const [item] = await db
      .insert(gearItems)
      .values({
        shopId: input.shopId,
        kind: input.kind,
        label,
        size: optional(input.size),
        serialNumber: optional(input.serialNumber),
        brandModel: optional(input.brandModel),
        purchasedOn,
        aboardBoatId: aboardBoatId ?? null,
      })
      .returning();
    if (!item) return { ok: false, reason: "duplicate_label" };
    return { ok: true, item };
  } catch (error) {
    if (violatesUniqueIndex(error, "gear_items_shop_label_unique")) {
      return { ok: false, reason: "duplicate_label" };
    }
    throw error;
  }
}

export type UpdateGearItemOutcome =
  | { ok: true; item: GearItem }
  | {
      ok: false;
      reason: "not_found" | "empty_label" | "duplicate_label" | "invalid_date" | "invalid_boat";
    };

export async function updateGearItem(
  db: AppDb,
  input: GearItemInput & { gearItemId: string },
): Promise<UpdateGearItemOutcome> {
  const label = input.label.trim();
  if (!label) return { ok: false, reason: "empty_label" };
  const purchasedOn = optional(input.purchasedOn);
  if (purchasedOn && !isValidCalendarDate(purchasedOn))
    return { ok: false, reason: "invalid_date" };
  const aboardBoatId = await aboardBoatFor(db, input.shopId, input.kind, input.aboardBoatId);
  if (aboardBoatId === "invalid") return { ok: false, reason: "invalid_boat" };
  try {
    const [item] = await db
      .update(gearItems)
      .set({
        kind: input.kind,
        label,
        size: optional(input.size),
        serialNumber: optional(input.serialNumber),
        brandModel: optional(input.brandModel),
        purchasedOn,
        // Left out of the write when the form did not carry it, so a unit's
        // hull survives an edit from a form that never showed the select.
        ...(aboardBoatId === undefined ? {} : { aboardBoatId }),
        updatedAt: nowDate(),
      })
      .where(
        and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId), liveGearItem()),
      )
      .returning();
    return item ? { ok: true, item } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (violatesUniqueIndex(error, "gear_items_shop_label_unique")) {
      return { ok: false, reason: "duplicate_label" };
    }
    throw error;
  }
}

export type SetGearItemStatusOutcome =
  | { ok: true; item: GearItem }
  | { ok: false; reason: "not_found" };

/**
 * Move a unit between in service and needs service. The service note travels
 * with `needs_service` ("inflator sticks") and is cleared on the way back in —
 * a stale complaint on a fixed unit reads as an open one.
 */
export async function setGearItemStatus(
  db: DbExecutor,
  input: { shopId: string; gearItemId: string; status: GearItemStatus; serviceNote?: string },
): Promise<SetGearItemStatusOutcome> {
  const [item] = await db
    .update(gearItems)
    .set({
      status: input.status,
      serviceNote: input.status === "in_service" ? null : optional(input.serviceNote),
      updatedAt: nowDate(),
    })
    .where(
      and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId), liveGearItem()),
    )
    .returning();
  return item ? { ok: true, item } : { ok: false, reason: "not_found" };
}

export type DeleteGearItemOutcome =
  | { ok: true; deleted: GearItem }
  | { ok: false; reason: "not_found" | "reserved" };

/**
 * Take a unit off the register — soft, like every other delete (ADR
 * 20260820-every-delete-is-soft). It stamps `deleted_at` and leaves the row
 * where it is, so the unit's service events and every rental window it ever
 * carried stay attached and a restore is one column write.
 *
 * **Refuses a unit that is still provisioned**, the same call `deleteTrip`
 * makes for a departure with a roster: a unit reserved for a departure still
 * to come, or one out on a rental right now, is somebody's kit for the
 * weekend, and hiding it from the register would leave a diver's assignment
 * pointing at a unit nobody can find. The refusal names nothing here — the
 * surface knows which reservation holds it — and the way out is the same page's
 * Release or Mark returned.
 *
 * A lapsed claim nobody ever collected does **not** block: that unit is on the
 * wall (the same call `listAvailableGearUnits` makes), and its stale row goes
 * quiet with the unit and comes back with it.
 *
 * The guard is checked under a row lock, so a reservation landing mid-delete
 * loses the race rather than being silently hidden with its unit.
 */
export async function deleteGearItem(
  db: AppDb,
  input: {
    shopId: string;
    gearItemId: string;
    todayLocal: CalendarDate;
    deletedByPersonId?: string;
  },
): Promise<DeleteGearItemOutcome> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(gearItems)
      .where(
        and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId), liveGearItem()),
      )
      .limit(1)
      .for("update");
    if (!item) return { ok: false, reason: "not_found" } as const;

    const [held] = await tx
      .select({ value: count() })
      .from(gearReservations)
      .where(
        and(
          eq(gearReservations.shopId, input.shopId),
          eq(gearReservations.gearItemId, input.gearItemId),
          openGearReservation(),
          or(
            // Out the door now, whatever its window says…
            isNotNull(gearReservations.checkedOutAt),
            // …or spoken for today or on a day still to come.
            gte(gearReservations.reservedUntil, input.todayLocal),
          ),
        ),
      );
    if ((held?.value ?? 0) > 0) return { ok: false, reason: "reserved" } as const;

    const [deleted] = await tx
      .update(gearItems)
      .set({
        deletedAt: nowDate(),
        deletedByPersonId: input.deletedByPersonId ?? null,
        updatedAt: nowDate(),
      })
      .where(and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId)))
      .returning();
    return deleted
      ? ({ ok: true, deleted } as const)
      : ({ ok: false, reason: "not_found" } as const);
  });
}

export type RestoreGearItemOutcome =
  | { ok: true; item: GearItem }
  | { ok: false; reason: "not_found" | "duplicate_label" };

/**
 * Put a deleted unit back on the register — the undo toast's action, and the
 * deleted list's. The tag freed up when the unit went, so another unit may be
 * wearing it now: the partial unique index refuses that, and so does this,
 * rather than putting two "BCD #14"s on one wall.
 */
export async function restoreGearItem(
  db: AppDb,
  input: { shopId: string; gearItemId: string },
): Promise<RestoreGearItemOutcome> {
  try {
    const [item] = await db
      .update(gearItems)
      .set({ deletedAt: null, deletedByPersonId: null, updatedAt: nowDate() })
      .where(
        and(
          eq(gearItems.id, input.gearItemId),
          eq(gearItems.shopId, input.shopId),
          isNotNull(gearItems.deletedAt),
        ),
      )
      .returning();
    return item ? { ok: true, item } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (violatesUniqueIndex(error, "gear_items_shop_label_unique")) {
      return { ok: false, reason: "duplicate_label" };
    }
    throw error;
  }
}

/** Presence is the register's on-switch: zero rows means no gear UI anywhere. */
export async function countGearItems(db: AppDb, shopId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), liveGearItem()));
  return row?.value ?? 0;
}
