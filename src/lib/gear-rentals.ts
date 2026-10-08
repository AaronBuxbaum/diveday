import type { CalendarDate } from "@/lib/calendar-date";
import { type GearReservationPhase, reservationPhase } from "@/lib/gear";

/**
 * **Every open rental, by who has it** — the register's Rentals view (plan
 * `rental-tracking`, layer 2). The register's groups answer "where is this
 * unit?"; this answers the counter's other question, "who has our gear, until
 * when, and have they paid?", for trip rentals and counter rentals alike.
 *
 * Pure: the reader in `src/db/gear-rentals.ts` hands over one row per open
 * reservation and this folds them into holders and rentals. A *rental* is the
 * set of units one holder took under one booking, or over the counter with no
 * booking at all (the ADR 20260815-minimal-gear-register amendment of
 * 2026-08-25: a reservation is held by a booking or a person, never both).
 *
 * States are the register's own (`reservationPhase`), never a second
 * vocabulary: the same unit reads "Overdue" here and on its register row.
 */

/** The fields the fold reads off one open reservation. */
export type GearRentalUnitInput = {
  reservationId: string;
  reservedFrom: CalendarDate;
  reservedUntil: CalendarDate;
  checkedOutAt: Date | null;
  holderPersonId: string;
  holderName: string;
  /** Null for a counter rental, which no booking holds. */
  bookingId: string | null;
};

/** How loudly a phase asks for the desk, most urgent first. */
const PHASE_URGENCY: Record<Exclude<GearReservationPhase, "returned">, number> = {
  overdue: 0,
  never_picked_up: 1,
  due_back_today: 2,
  out: 3,
  reserved: 4,
};

export type OpenRentalPhase = Exclude<GearReservationPhase, "returned">;

function openPhase(unit: GearRentalUnitInput, todayLocal: CalendarDate): OpenRentalPhase {
  const phase = reservationPhase({ ...unit, returnedAt: null }, todayLocal);
  // `returnedAt` is null by construction, so `returned` cannot come back; the
  // narrowing is for the compiler, and the fallback is the quietest word.
  return phase === "returned" ? "reserved" : phase;
}

export type GearRental<T extends GearRentalUnitInput> = {
  /** The booking id, or `counter:<person id>` for the units a person holds with none. */
  key: string;
  bookingId: string | null;
  /** The earliest day any unit in it is spoken for. */
  from: CalendarDate;
  /** The latest day any unit in it is due back. */
  until: CalendarDate;
  /** The most urgent phase among its units: the one the desk acts on first. */
  phase: OpenRentalPhase;
  /** Its units, each with its own phase, earliest due back first. */
  units: (T & { phase: OpenRentalPhase })[];
};

export type GearRentalHolder<T extends GearRentalUnitInput> = {
  personId: string;
  name: string;
  /** Earliest due back first, so a lapsed rental leads. */
  rentals: GearRental<T>[];
};

function rentalKey(unit: GearRentalUnitInput): string {
  return unit.bookingId ?? `counter:${unit.holderPersonId}`;
}

function byDueBack(
  a: { until: CalendarDate; phase: OpenRentalPhase },
  b: { until: CalendarDate; phase: OpenRentalPhase },
): number {
  return a.until.localeCompare(b.until) || PHASE_URGENCY[a.phase] - PHASE_URGENCY[b.phase];
}

/**
 * Fold open reservations into holders, each holder's rentals, and each
 * rental's units — sorted by due-back date so the overdue lead.
 *
 * Due-back order puts the overdue first without a rule of its own: a lapsed
 * window ended before today and every other one ends today or later. The
 * phase only breaks ties, so on one date an overdue set still outranks a
 * never-collected one (a phone call before a release).
 */
export function groupGearRentals<T extends GearRentalUnitInput>(
  units: readonly T[],
  todayLocal: CalendarDate,
): GearRentalHolder<T>[] {
  const holders = new Map<string, { name: string; rentals: Map<string, GearRental<T>> }>();
  for (const unit of units) {
    const phased = { ...unit, phase: openPhase(unit, todayLocal) };
    const holder = holders.get(unit.holderPersonId) ?? {
      name: unit.holderName,
      rentals: new Map<string, GearRental<T>>(),
    };
    holders.set(unit.holderPersonId, holder);
    const key = rentalKey(unit);
    const rental = holder.rentals.get(key);
    if (!rental) {
      holder.rentals.set(key, {
        key,
        bookingId: unit.bookingId,
        from: unit.reservedFrom,
        until: unit.reservedUntil,
        phase: phased.phase,
        units: [phased],
      });
      continue;
    }
    rental.units.push(phased);
    if (unit.reservedFrom < rental.from) rental.from = unit.reservedFrom;
    if (unit.reservedUntil > rental.until) rental.until = unit.reservedUntil;
    if (PHASE_URGENCY[phased.phase] < PHASE_URGENCY[rental.phase]) rental.phase = phased.phase;
  }

  const grouped = [...holders.entries()].map(([personId, holder]) => {
    const rentals = [...holder.rentals.values()];
    for (const rental of rentals) {
      // A stable sort: units due on the same day keep the reader's own
      // order, which is the register's kind-then-tag.
      rental.units.sort((a, b) =>
        byDueBack(
          { until: a.reservedUntil, phase: a.phase },
          { until: b.reservedUntil, phase: b.phase },
        ),
      );
    }
    rentals.sort((a, b) => byDueBack(a, b) || a.key.localeCompare(b.key));
    return { personId, name: holder.name, rentals };
  });
  return grouped.sort((a, b) => {
    const [firstA] = a.rentals;
    const [firstB] = b.rentals;
    if (!firstA || !firstB) return 0;
    return byDueBack(firstA, firstB) || a.name.localeCompare(b.name);
  });
}

/** Whether a phase is one the desk has to chase: a window that has already closed. */
export function rentalPhaseLapsed(phase: OpenRentalPhase): boolean {
  return phase === "overdue" || phase === "never_picked_up";
}
