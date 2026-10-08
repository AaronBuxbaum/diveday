import { and, asc, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { type CounterRentalWindowRefusal, checkCounterRentalWindow } from "@/lib/counter-rentals";
import type { GearItemKind, GearReturnOutcome } from "@/lib/gear";
import type { AppDb } from "./client";
import type { GearReservationActionOutcome } from "./gear";
import { violatesExclusionConstraint } from "./query-helpers";
import { gearItems, gearReservations, orders, people } from "./schema";

/**
 * **Counter rentals** — units lent to a person who is not on a boat that day
 * (ADR 20260815-minimal-gear-register, amendments 2026-08-25 and 2026-10-08).
 *
 * A counter rental is not a table. It is a set of person-held
 * `gear_reservations` rows (`person_id` set, `booking_id` null) written in one
 * transaction, and **that transaction is its identity**: every row it inserts
 * takes the same `created_at` from Postgres' `now()`, which is the
 * transaction's start time, so the person and that stamp together name the
 * rental. The ticket URL carries any one of its reservation ids and the reader
 * below finds the rest.
 *
 * Check-out, return and release are the register's own single-unit writers
 * (`checkOutGearReservation`, `returnGearReservation`, `releaseGearReservation`
 * in `./gear.ts`), which act on a reservation id and never asked for a booking.
 * Money is never on these rows: an invoice, when there is one, is an ordinary
 * staff order (`createOrder`) and `order_id` only points at it.
 */

/** The most units one rental may carry — a family's kit, not a fleet. */
export const COUNTER_RENTAL_MAX_UNITS = 20;

export type CreateCounterRentalOutcome =
  | { ok: true; ticketId: string; reservationIds: string[] }
  | {
      ok: false;
      reason:
        | CounterRentalWindowRefusal
        | "no_units"
        | "too_many_units"
        | "person_not_found"
        | "unit_not_found"
        | "unit_out_of_service";
    }
  | { ok: false; reason: "unit_unavailable"; unitLabel: string };

/**
 * The person a counter rental may be written for: this shop's, and not
 * deleted. What the form shows as "Who", and what the invoice needs to know
 * (an invoice goes to an email, so one without is not offered).
 */
export async function counterRentalPerson(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<{ id: string; fullName: string; email: string | null; phone: string | null } | null> {
  const [row] = await db
    .select({ id: people.id, fullName: people.fullName, email: people.email, phone: people.phone })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNull(people.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Thrown inside the transaction to roll it back with a worded refusal. */
class CounterRentalRefused extends Error {
  constructor(readonly outcome: Extract<CreateCounterRentalOutcome, { ok: false }>) {
    super(outcome.reason);
  }
}

/**
 * Lend these units to this person for an inclusive window of shop-local dates.
 *
 * **All or nothing.** Every unit is inserted in one transaction, so a rental is
 * never half-written: one unit already spoken for refuses the whole set, and
 * the refusal names that unit so the staffer can pick another.
 *
 * **The database decides double booking.** The `gear_reservations_no_overlap`
 * exclusion constraint refuses an overlapping window for the same unit and
 * this catches its 23P01; nothing here pre-checks availability, because a
 * check two staff can both read past is the bug that constraint exists for.
 * The per-unit advisory locks are `reserveGearUnit`'s, taken in a fixed order:
 * they make a racing writer wait for this commit, so the constraint judges
 * committed rows and the loser gets the worded refusal rather than a deadlock.
 *
 * **Tenancy.** The person and every unit must belong to `shopId`; a deleted
 * person, a deleted unit or another shop's row reads as not found. A unit
 * pulled for service is refused, as the trip writer refuses it.
 */
export async function createCounterRental(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    gearItemIds: readonly string[];
    reservedFrom: string;
    reservedUntil: string;
    todayLocal: CalendarDate;
  },
): Promise<CreateCounterRentalOutcome> {
  const reservedFrom = input.reservedFrom.trim();
  const reservedUntil = input.reservedUntil.trim();
  const windowRefusal = checkCounterRentalWindow({
    from: reservedFrom,
    until: reservedUntil,
    todayLocal: input.todayLocal,
  });
  if (windowRefusal) return { ok: false, reason: windowRefusal };

  // Sorted so two rentals sharing units take their locks in the same order.
  const unitIds = [...new Set(input.gearItemIds)].sort();
  if (unitIds.length === 0) return { ok: false, reason: "no_units" };
  if (unitIds.length > COUNTER_RENTAL_MAX_UNITS) return { ok: false, reason: "too_many_units" };

  const labels = new Map<string, string>();
  let inserting: string | null = null;
  try {
    return await db.transaction(async (tx) => {
      for (const unitId of unitIds) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('gear_reservations'), hashtext(${unitId}))`,
        );
      }

      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(
            eq(people.id, input.personId),
            eq(people.shopId, input.shopId),
            isNull(people.deletedAt),
          ),
        )
        .limit(1);
      if (!person) throw new CounterRentalRefused({ ok: false, reason: "person_not_found" });

      const units = await tx
        .select({ id: gearItems.id, label: gearItems.label, status: gearItems.status })
        .from(gearItems)
        .where(
          and(
            eq(gearItems.shopId, input.shopId),
            inArray(gearItems.id, unitIds),
            isNull(gearItems.deletedAt),
          ),
        );
      if (units.length !== unitIds.length) {
        throw new CounterRentalRefused({ ok: false, reason: "unit_not_found" });
      }
      if (units.some((unit) => unit.status !== "in_service")) {
        throw new CounterRentalRefused({ ok: false, reason: "unit_out_of_service" });
      }
      for (const unit of units) labels.set(unit.id, unit.label);

      // One statement per unit, so a refusal can say which unit lost. The
      // first 23P01 aborts the transaction, which is the all-or-nothing.
      const reservationIds: string[] = [];
      for (const unitId of unitIds) {
        inserting = unitId;
        const [row] = await tx
          .insert(gearReservations)
          .values({
            shopId: input.shopId,
            gearItemId: unitId,
            personId: person.id,
            reservedFrom,
            reservedUntil,
          })
          .returning({ id: gearReservations.id });
        if (!row) throw new Error("createCounterRental: insert returned no row");
        reservationIds.push(row.id);
      }
      inserting = null;
      const [ticketId] = reservationIds;
      if (!ticketId) throw new Error("createCounterRental: no reservation written");
      return { ok: true as const, ticketId, reservationIds };
    });
  } catch (error) {
    if (error instanceof CounterRentalRefused) return error.outcome;
    if (violatesExclusionConstraint(error, "gear_reservations_no_overlap")) {
      return {
        ok: false,
        reason: "unit_unavailable",
        unitLabel: (inserting && labels.get(inserting)) ?? "",
      };
    }
    throw error;
  }
}

/**
 * Point a counter rental at the invoice it was billed on. Only rows of this
 * shop, held by the order's own person, and not already linked — so a crafted
 * call cannot hang one diver's rental on another diver's invoice, and a second
 * invoice cannot quietly replace the first.
 */
export async function linkCounterRentalOrder(
  db: AppDb,
  input: { shopId: string; reservationIds: readonly string[]; orderId: string },
): Promise<number> {
  if (input.reservationIds.length === 0) return 0;
  const [order] = await db
    .select({ id: orders.id, personId: orders.personId })
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.shopId, input.shopId)))
    .limit(1);
  if (!order) return 0;
  const linked = await db
    .update(gearReservations)
    .set({ orderId: order.id })
    .where(
      and(
        eq(gearReservations.shopId, input.shopId),
        inArray(gearReservations.id, [...input.reservationIds]),
        eq(gearReservations.personId, order.personId),
        isNull(gearReservations.bookingId),
        isNull(gearReservations.orderId),
      ),
    )
    .returning({ id: gearReservations.id });
  return linked.length;
}

/**
 * Every row of the counter rental this reservation belongs to: same shop, same
 * person, no booking, and the same transaction stamp — compared inside
 * Postgres, because `timestamptz` keeps microseconds and a JavaScript `Date`
 * keeps milliseconds, so a stamp read out and passed back in would match
 * nothing.
 */
function sameCounterRental(shopId: string, reservationId: string): SQL {
  return sql`(${gearReservations.shopId} = ${shopId}
    and ${gearReservations.bookingId} is null
    and (${gearReservations.personId}, ${gearReservations.createdAt}) = (
      select anchor.person_id, anchor.created_at from gear_reservations anchor
      where anchor.id = ${reservationId} and anchor.shop_id = ${shopId}
        and anchor.booking_id is null
    ))`;
}

/**
 * **Hand the whole rental across in one act** — the counter's twin of
 * `checkOutTripGearSet`. Conditional on the stamp being empty, so a unit
 * already out keeps the time it left, and a rental with nothing left on the
 * wall is `not_found` rather than a silent success.
 */
export async function checkOutCounterRental(
  db: AppDb,
  input: { shopId: string; ticketId: string },
): Promise<GearReservationActionOutcome> {
  const handedOver = await db
    .update(gearReservations)
    .set({ checkedOutAt: nowDate() })
    .where(
      and(
        sameCounterRental(input.shopId, input.ticketId),
        isNull(gearReservations.checkedOutAt),
        isNull(gearReservations.returnedAt),
      ),
    )
    .returning({ id: gearReservations.id });
  return handedOver.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * **Bring the whole rental home in one act**, the outcome asked once — the
 * twin of `returnTripGearSet`, with its rules: only units that left are
 * closed, a service concern must carry words, and the refusal comes before
 * anything is written so a set is never half-closed.
 */
export async function returnCounterRental(
  db: AppDb,
  input: { shopId: string; ticketId: string; outcome: GearReturnOutcome; note?: string },
): Promise<GearReservationActionOutcome> {
  const note = input.note?.trim() || null;
  if (input.outcome === "service_concern" && !note) {
    return { ok: false, reason: "concern_needs_words" };
  }
  const returned = await db
    .update(gearReservations)
    .set({ returnedAt: nowDate(), returnNote: note, returnOutcome: input.outcome })
    .where(
      and(
        sameCounterRental(input.shopId, input.ticketId),
        isNotNull(gearReservations.checkedOutAt),
        isNull(gearReservations.returnedAt),
      ),
    )
    .returning({ id: gearReservations.id });
  return returned.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * Let go of the units this rental never collected — a booking made at the
 * counter that the person did not come back for. Units already out stay: a
 * release would erase the only record of who has them, and the return is the
 * honest close (`releaseGearReservation`'s rule, for the set).
 */
export async function releaseCounterRental(
  db: AppDb,
  input: { shopId: string; ticketId: string },
): Promise<GearReservationActionOutcome> {
  const released = await db
    .delete(gearReservations)
    .where(
      and(
        sameCounterRental(input.shopId, input.ticketId),
        isNull(gearReservations.checkedOutAt),
        isNull(gearReservations.returnedAt),
      ),
    )
    .returning({ id: gearReservations.id });
  return released.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

export type CounterRentalUnit = {
  reservationId: string;
  gearItemId: string;
  kind: GearItemKind;
  label: string;
  size: string | null;
  checkedOutAt: Date | null;
  returnedAt: Date | null;
  returnOutcome: GearReturnOutcome | null;
};

export type CounterRentalTicket = {
  ticketId: string;
  personId: string;
  personName: string;
  reservedFrom: CalendarDate;
  reservedUntil: CalendarDate;
  createdAt: Date;
  orderId: string | null;
  units: CounterRentalUnit[];
};

/**
 * One counter rental, found from any of its reservation ids — the ticket's
 * read. Null for a booking-held reservation (that one prints from the trip's
 * slip), for another shop's id, and for a rental whose every unit has been
 * released. Deleted units stay on it: the ticket is a record of what went out.
 */
export async function getCounterRentalTicket(
  db: AppDb,
  shopId: string,
  reservationId: string,
): Promise<CounterRentalTicket | null> {
  const [anchor] = await db
    .select({ personId: gearReservations.personId })
    .from(gearReservations)
    .where(
      and(
        eq(gearReservations.id, reservationId),
        eq(gearReservations.shopId, shopId),
        isNull(gearReservations.bookingId),
        isNotNull(gearReservations.personId),
      ),
    )
    .limit(1);
  if (!anchor?.personId) return null;
  const rows = await counterRentalRows(db, shopId, {
    personId: anchor.personId,
    sameRentalAs: reservationId,
  });
  return groupCounterRentals(rows)[0] ?? null;
}

/**
 * A person's counter rentals that are still open — reserved or out — oldest
 * window first, for the diver record. A rental with every unit home is done
 * and leaves this list; its ticket stays readable.
 */
export async function listOpenCounterRentalsForPerson(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<CounterRentalTicket[]> {
  const rows = await counterRentalRows(db, shopId, { personId, openOnly: true });
  return groupCounterRentals(rows);
}

/**
 * The counter rental billed on this order, as a ticket id to link to, or null.
 * The order page's way back to what it paid for.
 */
export async function counterRentalTicketIdForOrder(
  db: AppDb,
  shopId: string,
  orderId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: gearReservations.id })
    .from(gearReservations)
    .where(and(eq(gearReservations.shopId, shopId), eq(gearReservations.orderId, orderId)))
    // diveday:allow-time-id-order: nobody is shown this order; any row of the
    // rental is its ticket id, and the first is just a stable pick.
    .orderBy(asc(gearReservations.createdAt), asc(gearReservations.id))
    .limit(1);
  return row?.id ?? null;
}

type CounterRentalRow = CounterRentalUnit & {
  personId: string;
  personName: string;
  reservedFrom: CalendarDate;
  reservedUntil: CalendarDate;
  createdAt: Date;
  rentalKey: string;
  orderId: string | null;
};

async function counterRentalRows(
  db: AppDb,
  shopId: string,
  filter: {
    personId: string;
    /** Only the rows of the counter rental this reservation belongs to. */
    sameRentalAs?: string;
    openOnly?: boolean;
  },
): Promise<CounterRentalRow[]> {
  const rows = await db
    .select({
      reservationId: gearReservations.id,
      gearItemId: gearItems.id,
      kind: gearItems.kind,
      label: gearItems.label,
      size: gearItems.size,
      checkedOutAt: gearReservations.checkedOutAt,
      returnedAt: gearReservations.returnedAt,
      returnOutcome: gearReservations.returnOutcome,
      personId: people.id,
      personName: people.fullName,
      reservedFrom: gearReservations.reservedFrom,
      reservedUntil: gearReservations.reservedUntil,
      createdAt: gearReservations.createdAt,
      // The full-precision stamp, for grouping: two rentals a microsecond
      // apart are two rentals, which a millisecond `Date` cannot tell.
      rentalKey: sql<string>`${gearReservations.createdAt}::text`,
      orderId: gearReservations.orderId,
    })
    .from(gearReservations)
    .innerJoin(
      gearItems,
      and(eq(gearItems.id, gearReservations.gearItemId), eq(gearItems.shopId, shopId)),
    )
    // The shop condition on the joined person is defense-in-depth, as on every
    // register read: the writer proves the person is this shop's.
    .innerJoin(people, and(eq(people.id, gearReservations.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        eq(gearReservations.personId, filter.personId),
        isNull(gearReservations.bookingId),
        filter.sameRentalAs ? sameCounterRental(shopId, filter.sameRentalAs) : undefined,
        filter.openOnly ? isNull(gearReservations.returnedAt) : undefined,
      ),
    )
    .orderBy(
      asc(gearReservations.reservedFrom),
      asc(gearReservations.createdAt),
      asc(gearItems.kind),
      asc(gearItems.label),
    );
  return rows;
}

/** Rows in, rentals out: one per (person, transaction stamp), in row order. */
function groupCounterRentals(rows: readonly CounterRentalRow[]): CounterRentalTicket[] {
  const byKey = new Map<string, CounterRentalTicket>();
  for (const row of rows) {
    const key = `${row.personId}:${row.rentalKey}`;
    let rental = byKey.get(key);
    if (!rental) {
      rental = {
        ticketId: row.reservationId,
        personId: row.personId,
        personName: row.personName,
        reservedFrom: row.reservedFrom,
        reservedUntil: row.reservedUntil,
        createdAt: row.createdAt,
        orderId: row.orderId,
        units: [],
      };
      byKey.set(key, rental);
    }
    rental.orderId ??= row.orderId;
    rental.units.push({
      reservationId: row.reservationId,
      gearItemId: row.gearItemId,
      kind: row.kind,
      label: row.label,
      size: row.size,
      checkedOutAt: row.checkedOutAt,
      returnedAt: row.returnedAt,
      returnOutcome: row.returnOutcome,
    });
  }
  return [...byKey.values()];
}
