import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { CalendarDate } from "@/lib/calendar-date";
import type { CertificationLevel } from "@/lib/certification-levels";
import { nowDate } from "@/lib/clock";
import {
  type CounterRentalCardRefusal,
  type CounterRentalWindowRefusal,
  type CounterTankFillRefusal,
  checkCounterRentalWindow,
  counterRentalCardRefusal,
  counterTankFillRefusal,
  isEnrichedFill,
  isLifeSupportKind,
} from "@/lib/counter-rentals";
import {
  type GearItemKind,
  type GearReturnOutcome,
  gearServiceKeepsUnitBack,
  gearServiceState,
} from "@/lib/gear";
import { type ShopWaiverStatus, shopWaiverStatus } from "@/lib/waivers";
import type { AppDb } from "./client";
import {
  type GearReservationActionOutcome,
  type GearSetReturnOutcome,
  latestServiceClocks,
  openGearReservation,
  openServiceConcerns,
  pullReturnedUnitsForService,
} from "./gear";
import { peopleMinorDeclared } from "./minor-declared";
import { authorizesNitroxFill } from "./nitrox";
import { violatesExclusionConstraint } from "./query-helpers";
import {
  type CertificationReviewRefusal,
  createCertification,
  createSpecialtyCertification,
  reviewCertification,
  reviewSpecialtyCertification,
} from "./readiness";
import {
  type CertificationAgency,
  certifications,
  gearItems,
  gearReservations,
  nitroxCertifications,
  orders,
  people,
  specialtyCertifications,
} from "./schema";
import { getCurrentWaiverGeneration, listSignedWaiversByPerson } from "./waivers";

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
        | "unit_out_of_service"
        | CounterRentalCardRefusal
        | CounterTankFillRefusal;
    }
  | {
      ok: false;
      /**
       * `unit_unavailable`: the exclusion constraint refused it.
       * `unit_needs_service`: life support whose clock runs out inside the
       * window, or that came home with a concern nobody has serviced since.
       * `unit_needs_confirm`: soft goods carrying one of those flags, which
       * the staffer did not confirm lending anyway.
       */
      reason: "unit_unavailable" | "unit_needs_service" | "unit_needs_confirm";
      unitId: string;
    };

/**
 * The person a counter rental may be written for: this shop's, and not
 * deleted. What the form shows as "Who", and what the invoice needs to know
 * (an invoice goes to an email, so one without is not offered).
 */
export async function counterRentalPerson(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<{
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: CalendarDate | null;
} | null> {
  const [row] = await db
    .select({
      id: people.id,
      fullName: people.fullName,
      email: people.email,
      phone: people.phone,
      dateOfBirth: people.dateOfBirth,
    })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNull(people.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * The cards the counter reads before lending life support: this person's live
 * level and specialty cards in this shop, whatever their status. The predicate
 * (`counterRentalCardRefusal`) decides which of them count.
 */
export async function counterRentalCards(db: AppDb, shopId: string, personId: string) {
  const [levels, specialties] = await Promise.all([
    db
      .select()
      .from(certifications)
      .where(
        and(
          eq(certifications.shopId, shopId),
          eq(certifications.personId, personId),
          isNull(certifications.deletedAt),
        ),
      ),
    db
      .select()
      .from(specialtyCertifications)
      .where(
        and(
          eq(specialtyCertifications.shopId, shopId),
          eq(specialtyCertifications.personId, personId),
          isNull(specialtyCertifications.deletedAt),
        ),
      ),
  ]);
  return { certifications: levels, specialtyCertifications: specialties };
}

/** Picker hint only; the rental transaction rechecks the same predicate. */
export async function counterRentalHasNitroxFillCard(db: AppDb, shopId: string, personId: string) {
  const [card] = await db
    .select({ id: nitroxCertifications.id })
    .from(nitroxCertifications)
    .where(
      and(
        eq(nitroxCertifications.shopId, shopId),
        eq(nitroxCertifications.personId, personId),
        authorizesNitroxFill,
      ),
    )
    .limit(1);
  return Boolean(card);
}

/** A card a staffer holds in their hand at the counter, and what it is. */
export type CounterRentalCardSighting =
  | { card: "level"; level: CertificationLevel }
  | { card: "drysuit" };

/**
 * **"Card seen"** — the counter's way past the card rule, and the only one.
 * It is the diver record's own capture-then-certify act, done in one step by
 * the staffer holding the card: the card is written with its agency and
 * number, then marked verified with that staffer as the reviewer, so the
 * record says who saw it and when (`reviewed_by_person_id`, `reviewed_at`).
 * There is no bare "I checked" box: a tick records nothing anybody can look
 * up afterwards, and the card number is what a shop checks with the agency
 * (ADR 20260804-card-evidence-is-the-number).
 *
 * A card this shop already holds by the same agency and number is refused
 * (`duplicate_card`): it is already on the diver record, waiting to be
 * confirmed there, and a second row would split one card in two.
 */
export async function recordCounterRentalCardSighting(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    seenByPersonId: string;
    agency: CertificationAgency;
    identifier: string;
    sighting: CounterRentalCardSighting;
  },
): Promise<{ ok: true } | { ok: false; reason: CertificationReviewRefusal }> {
  const common = {
    shopId: input.shopId,
    personId: input.personId,
    agency: input.agency,
    identifier: input.identifier,
  };
  if (input.sighting.card === "level") {
    const card = await createCertification(db, { ...common, level: input.sighting.level });
    if (!card) return { ok: false, reason: "duplicate_card" };
    const reviewed = await reviewCertification(db, {
      shopId: input.shopId,
      certificationId: card.id,
      status: "verified",
      reviewedByPersonId: input.seenByPersonId,
    });
    return reviewed.ok ? { ok: true } : reviewed;
  }
  const card = await createSpecialtyCertification(db, { ...common, specialty: "drysuit" });
  if (!card) return { ok: false, reason: "duplicate_card" };
  const reviewed = await reviewSpecialtyCertification(db, {
    shopId: input.shopId,
    certificationId: card.id,
    status: "verified",
    reviewedByPersonId: input.seenByPersonId,
  });
  return reviewed.ok ? { ok: true } : reviewed;
}

/** A unit's label, read for this shop only — the words a refusal names. */
export async function counterRentalUnitLabel(
  db: AppDb,
  shopId: string,
  gearItemId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ label: gearItems.label })
    .from(gearItems)
    .where(and(eq(gearItems.id, gearItemId), eq(gearItems.shopId, shopId)))
    .limit(1);
  return row?.label ?? null;
}

/**
 * Units these people hold on a counter rental whose window overlaps this
 * shop-local window and that are not home yet, by person — for a departure's
 * Gear tab, where a diver already carrying the shop's regulator should not be
 * handed a second one. Informs, never gates: prep counts do not move.
 */
export async function counterRentalsHeldDuring(
  db: AppDb,
  shopId: string,
  personIds: readonly string[],
  window: { from: CalendarDate; until: CalendarDate },
): Promise<Map<string, { label: string; until: CalendarDate }[]>> {
  if (personIds.length === 0) return new Map();
  const rows = await db
    .select({
      personId: gearReservations.personId,
      label: gearItems.label,
      until: gearReservations.reservedUntil,
    })
    .from(gearReservations)
    .innerJoin(
      gearItems,
      and(eq(gearItems.id, gearReservations.gearItemId), eq(gearItems.shopId, shopId)),
    )
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        isNull(gearReservations.bookingId),
        inArray(gearReservations.personId, [...personIds]),
        openGearReservation(),
        lte(gearReservations.reservedFrom, window.until),
        gte(gearReservations.reservedUntil, window.from),
      ),
    )
    .orderBy(asc(gearItems.label));
  const byPerson = new Map<string, { label: string; until: CalendarDate }[]>();
  for (const row of rows) {
    if (!row.personId) continue;
    const held = byPerson.get(row.personId) ?? [];
    held.push({ label: row.label, until: row.until });
    byPerson.set(row.personId, held);
  }
  return byPerson;
}

export type CounterRentalServiceVerdict = {
  /** Kept back by its service record as of the window's last day. */
  flagged: boolean;
  lifeSupport: boolean;
};

/**
 * **The service screen at the counter** — the one place a service clock
 * gates (ADR 20260815-minimal-gear-register, amendment 2026-10-08). On a boat
 * a crew checks a unit at the dock before anyone breathes from it; across the
 * counter nobody does, and the unit is gone for days. So a unit is judged as
 * the departure's proposals judge it (`gearServiceKeepsUnitBack`), with the
 * clock read **as of the window's last day**: a regulator whose service lapses
 * on day two of a three-day rental is overdue for the rental.
 */
export async function counterRentalServiceVerdicts(
  db: AppDb,
  shopId: string,
  units: readonly { id: string; kind: GearItemKind }[],
  lastDay: CalendarDate,
): Promise<Map<string, CounterRentalServiceVerdict>> {
  const [clocks, concerns] = await Promise.all([
    latestServiceClocks(
      db,
      shopId,
      units.map((unit) => unit.id),
    ),
    openServiceConcerns(db, shopId, units),
  ]);
  return new Map(
    units.map((unit) => [
      unit.id,
      {
        flagged: gearServiceKeepsUnitBack({
          serviceState: gearServiceState(clocks.get(unit.id) ?? [], lastDay),
          serviceConcern: concerns.has(unit.id),
        }),
        lifeSupport: isLifeSupportKind(unit.kind),
      },
    ]),
  );
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
    /** Flagged soft goods the staffer confirmed lending anyway. */
    confirmedFlaggedIds?: readonly string[];
    /**
     * The gas recorded in each tank, by unit id, as oxygen percent (issue
     * #2257): 21 is air, 22 to 40 is EANx. A unit left out is not recorded.
     */
    tankFills?: Readonly<Record<string, number>>;
    /** The staffer recording the gas, for the ticket's "recorded by" (domain review A3). */
    fillRecordedByPersonId?: string;
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

  // The safety screens, before anything is locked or written. Both read
  // records nobody edits in the seconds between (cards, service history); the
  // exclusion constraint below is still the only judge of availability. The
  // person is read first so another shop's person is "not found", never "not
  // certified" (their cards are not this shop's to read).
  if (!(await counterRentalPerson(db, input.shopId, input.personId))) {
    return { ok: false, reason: "person_not_found" };
  }
  const kinds = await db
    .select({ id: gearItems.id, kind: gearItems.kind })
    .from(gearItems)
    .where(
      and(
        eq(gearItems.shopId, input.shopId),
        inArray(gearItems.id, unitIds),
        isNull(gearItems.deletedAt),
      ),
    )
    .orderBy(asc(gearItems.label));
  if (kinds.length !== unitIds.length) return { ok: false, reason: "unit_not_found" };
  const cardRefusal = counterRentalCardRefusal(
    kinds.map((unit) => unit.kind),
    await counterRentalCards(db, input.shopId, input.personId),
  );
  if (cardRefusal) return { ok: false, reason: cardRefusal };
  // **The fills' shape** — on a tank of this rental, in range — before any
  // card is read. The card half waits for the transaction below.
  const kindById = new Map(kinds.map((unit) => [unit.id, unit.kind] as const));
  const fills = Object.entries(input.tankFills ?? {}).map(([unitId, o2Percent]) => ({
    unitId,
    kind: kindById.get(unitId),
    o2Percent,
  }));
  if (fills.some((fill) => fill.kind === undefined)) return { ok: false, reason: "fill_invalid" };
  const filledIds = new Set(fills.map((fill) => fill.unitId));
  const unfilledTank = kinds.some((unit) => unit.kind === "tank" && !filledIds.has(unit.id));
  const fillShape = fills.flatMap(({ kind, o2Percent }) => (kind ? [{ kind, o2Percent }] : []));
  const fillShapeRefusal = counterTankFillRefusal(fillShape, true);
  if (fillShapeRefusal) return { ok: false, reason: fillShapeRefusal };
  // **Every tank says its gas** (domain review F1): a blank gas was the one
  // way an EANx fill could leave without meeting the card check.
  if (unfilledTank) return { ok: false, reason: "fill_missing" };
  const verdicts = await counterRentalServiceVerdicts(db, input.shopId, kinds, reservedUntil);
  const confirmed = new Set(input.confirmedFlaggedIds ?? []);
  for (const unit of kinds) {
    const verdict = verdicts.get(unit.id);
    if (!verdict?.flagged) continue;
    if (verdict.lifeSupport) return { ok: false, reason: "unit_needs_service", unitId: unit.id };
    if (!confirmed.has(unit.id))
      return { ok: false, reason: "unit_needs_confirm", unitId: unit.id };
  }

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

      // **EANx needs a nitrox card that authorizes a fill**, read in the same
      // transaction that writes the fill, through the one predicate every
      // nitrox fill gate shares (`authorizesNitroxFill`). Wrong gas is the
      // highest-consequence mistake a counter can make.
      if (fillShape.some((fill) => isEnrichedFill(fill.o2Percent))) {
        const [card] = await tx
          .select({ id: nitroxCertifications.id })
          .from(nitroxCertifications)
          .where(
            and(
              eq(nitroxCertifications.shopId, input.shopId),
              eq(nitroxCertifications.personId, person.id),
              authorizesNitroxFill,
            ),
          )
          .limit(1);
        const fillRefusal = counterTankFillRefusal(fillShape, Boolean(card));
        if (fillRefusal) throw new CounterRentalRefused({ ok: false, reason: fillRefusal });
      }

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
            // The rental's identity is this transaction's stamp (see
            // `sameCounterRental`), so it is the database's `now()`, never the
            // app clock: a pinned clock gives two rentals one instant and the
            // tickets would merge.
            createdAt: sql`now()`,
            ...(input.tankFills?.[unitId] === undefined
              ? {}
              : {
                  fillO2Percent: input.tankFills[unitId],
                  fillRecordedAt: sql`now()`,
                  fillRecordedByPersonId: input.fillRecordedByPersonId ?? null,
                }),
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
      return { ok: false, reason: "unit_unavailable", unitId: inserting ?? "" };
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
        isNull(gearReservations.releasedAt),
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
        openGearReservation(),
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
 *
 * **"Pull for service" too** (issue #2345): the units ticked under a concern
 * go to the bench through the same step a departure's return uses
 * ({@link pullReturnedUnitsForService}), in the same transaction, and the
 * answer says how many moved.
 */
export async function returnCounterRental(
  db: AppDb,
  input: {
    shopId: string;
    ticketId: string;
    outcome: GearReturnOutcome;
    note?: string;
    /** Dives the person did on the rental, when they said; each unit did them all. */
    dives?: number | null;
    /** The units ticked "Pull for service"; read only on a service concern. */
    pullGearItemIds?: readonly string[];
  },
): Promise<GearSetReturnOutcome> {
  const note = input.note?.trim() || null;
  if (input.outcome === "service_concern" && !note) {
    return { ok: false, reason: "concern_needs_words" };
  }
  return db.transaction(async (tx) => {
    const returned = await tx
      .update(gearReservations)
      .set({
        returnedAt: nowDate(),
        returnNote: note,
        returnOutcome: input.outcome,
        divesLogged: input.dives ?? null,
      })
      .where(
        and(
          sameCounterRental(input.shopId, input.ticketId),
          isNotNull(gearReservations.checkedOutAt),
          openGearReservation(),
        ),
      )
      .returning({ id: gearReservations.id, gearItemId: gearReservations.gearItemId });
    if (returned.length === 0) return { ok: false, reason: "not_found" } as const;
    const pulled = await pullReturnedUnitsForService(tx, {
      shopId: input.shopId,
      outcome: input.outcome,
      note,
      returnedGearItemIds: returned.map((row) => row.gearItemId),
      pullGearItemIds: input.pullGearItemIds,
    });
    return { ok: true, pulled } as const;
  });
}

/**
 * Let go of the units this rental never collected — a booking made at the
 * counter that the person did not come back for. Units already out stay: a
 * release would erase the only record of who has them, and the return is the
 * honest close (`releaseGearReservation`'s rule, for the set).
 *
 * **A release is a stamp, never a delete** (issue #2258): `released_at` and
 * who did it, so the record that the units were held for this person survives
 * a disputed no-show charge, while the window frees at once.
 *
 * **Not once it is invoiced.** A released rental drops off the ticket the
 * invoice links back to; letting go of a billed rental would leave an invoice
 * for gear the ticket no longer shows. The invoice is voided first, on the
 * order, by the people who may touch money.
 */
export async function releaseCounterRental(
  db: AppDb,
  input: { shopId: string; ticketId: string; releasedByPersonId: string },
): Promise<GearReservationActionOutcome | { ok: false; reason: "invoiced" }> {
  const [invoiced] = await db
    .select({ id: gearReservations.id })
    .from(gearReservations)
    .where(
      and(
        sameCounterRental(input.shopId, input.ticketId),
        isNotNull(gearReservations.orderId),
        isNull(gearReservations.releasedAt),
      ),
    )
    .limit(1);
  if (invoiced) return { ok: false, reason: "invoiced" };
  const released = await db
    .update(gearReservations)
    .set({ releasedAt: nowDate(), releasedByPersonId: input.releasedByPersonId })
    .where(
      and(
        sameCounterRental(input.shopId, input.ticketId),
        isNull(gearReservations.checkedOutAt),
        openGearReservation(),
      ),
    )
    .returning({ id: gearReservations.id });
  return released.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

export type CorrectCounterTankFillOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | CounterTankFillRefusal };

/**
 * **Correct the gas recorded on one counter tank** (domain reviews A3/F6,
 * security review X5): the staffer who wrote the wrong gas puts the right one
 * on the ticket, and the row then names them as its recorder. The same rules
 * as renting it: a tank, 21 to 40, and above air only for a person whose
 * nitrox card authorizes a fill (`authorizesNitroxFill`), read inside the
 * write's transaction. There is no clearing: a counter tank always says its
 * gas (F1). Only while the tank is held or out: once it is home or released,
 * the record is history and is not rewritten.
 */
export async function correctCounterTankFill(
  db: AppDb,
  input: { shopId: string; reservationId: string; o2Percent: number; byPersonId: string },
): Promise<CorrectCounterTankFillOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ kind: gearItems.kind, personId: gearReservations.personId })
      .from(gearReservations)
      .innerJoin(
        gearItems,
        and(eq(gearItems.id, gearReservations.gearItemId), eq(gearItems.shopId, input.shopId)),
      )
      .where(
        and(
          eq(gearReservations.id, input.reservationId),
          eq(gearReservations.shopId, input.shopId),
          isNull(gearReservations.bookingId),
          isNotNull(gearReservations.personId),
          openGearReservation(),
        ),
      )
      .for("update", { of: gearReservations })
      .limit(1);
    if (!row?.personId) return { ok: false, reason: "not_found" };
    const fill = [{ kind: row.kind, o2Percent: input.o2Percent }];
    const shapeRefusal = counterTankFillRefusal(fill, true);
    if (shapeRefusal) return { ok: false, reason: shapeRefusal };
    if (isEnrichedFill(input.o2Percent)) {
      const [card] = await tx
        .select({ id: nitroxCertifications.id })
        .from(nitroxCertifications)
        .where(
          and(
            eq(nitroxCertifications.shopId, input.shopId),
            eq(nitroxCertifications.personId, row.personId),
            authorizesNitroxFill,
          ),
        )
        .limit(1);
      if (!card) return { ok: false, reason: "no_nitrox_card" };
    }
    await tx
      .update(gearReservations)
      .set({
        fillO2Percent: input.o2Percent,
        fillRecordedAt: nowDate(),
        fillRecordedByPersonId: input.byPersonId,
      })
      .where(eq(gearReservations.id, input.reservationId));
    return { ok: true };
  });
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
  /** The recorded gas, as oxygen percent (21 is air); null on anything but a tank. */
  fillO2Percent: number | null;
  /** When and by whom the gas was recorded or last corrected (domain review A3). */
  fillRecordedAt: Date | null;
  fillRecordedByName: string | null;
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
  const fillRecorder = alias(people, "fill_recorder");
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
      fillO2Percent: gearReservations.fillO2Percent,
      fillRecordedAt: gearReservations.fillRecordedAt,
      fillRecordedByName: fillRecorder.fullName,
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
    .leftJoin(
      fillRecorder,
      and(
        eq(fillRecorder.id, gearReservations.fillRecordedByPersonId),
        eq(fillRecorder.shopId, shopId),
      ),
    )
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        eq(gearReservations.personId, filter.personId),
        isNull(gearReservations.bookingId),
        filter.sameRentalAs ? sameCounterRental(shopId, filter.sameRentalAs) : undefined,
        filter.openOnly ? openGearReservation() : isNull(gearReservations.releasedAt),
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
      fillO2Percent: row.fillO2Percent,
      fillRecordedAt: row.fillRecordedAt,
      fillRecordedByName: row.fillRecordedByName,
    });
  }
  return [...byKey.values()];
}

/**
 * **Where each counter-rental holder stands with the shop's release** (issue
 * #2261, H-20261008-counter-rental-waiver-informs): the ticket and the Rentals list say it, and nothing gates on
 * it. Read through the same `shopWaiverStatus` the diver record uses, because
 * the release belongs to the person — signed once, on any booking or on a link
 * sent from their record — so a counter has had a person's waiver to read all
 * along. Shop-scoped on every read; a person id from another shop answers
 * nothing, which the caller reads as "say nothing".
 *
 * The whole status, not just its state: a current release can stand over a
 * physician's earlier "not cleared" or an open referral (H-20261007-after-physician-says-no as amended),
 * and the counter says that warning as the manifest does.
 */
export async function counterRentalWaiverStandings(
  db: AppDb,
  input: { shopId: string; timezone: string; personIds: readonly string[] },
): Promise<Map<string, ShopWaiverStatus>> {
  const standings = new Map<string, ShopWaiverStatus>();
  const personIds = [...new Set(input.personIds)];
  if (personIds.length === 0) return standings;
  const now = nowDate();
  const [holders, signed, template, declaredPeople] = await Promise.all([
    db
      .select({ id: people.id, dateOfBirth: people.dateOfBirth })
      .from(people)
      .where(
        and(
          eq(people.shopId, input.shopId),
          inArray(people.id, personIds),
          isNull(people.deletedAt),
        ),
      ),
    listSignedWaiversByPerson(db, input.shopId, personIds),
    getCurrentWaiverGeneration(db, input.shopId),
    // A counter rental has no seat, so it reads the booker's "Under 18" off
    // any of the holder's seats still ahead (issue #2553), as the diver
    // record does.
    peopleMinorDeclared(db, { shopId: input.shopId, personIds, now }),
  ]);
  for (const holder of holders) {
    const minorDeclared = declaredPeople.has(holder.id);
    standings.set(
      holder.id,
      shopWaiverStatus({
        personSignedWaivers: signed.get(holder.id) ?? [],
        currentTemplateVersion: template?.materialGeneration ?? null,
        signer: { dateOfBirth: holder.dateOfBirth, minorDeclared, timezone: input.timezone },
        now,
      }),
    );
  }
  return standings;
}
