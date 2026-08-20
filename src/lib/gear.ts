/**
 * Domain rules for the gear register: the shop's own rental fleet as physical
 * units, each unit's service clocks, and the date-ranged reservation that
 * joins a unit to a booking (ADR 20260815-minimal-gear-register).
 *
 * The register sits strictly beneath rental fit: a fit says what a diver
 * needs and in what size, a unit says what the shop owns, and only a
 * reservation joins them. A shop with no units on the register keeps the
 * sizes-only prep flow untouched — opt-in is by presence, never a setting.
 *
 * Everything here is framework-free and pure. Truth about availability lives
 * in the database (the `gear_reservations_no_overlap` exclusion constraint),
 * never here — these rules only *word* and *rank* what the rows already say.
 */

import {
  type CalendarDate,
  calendarDateInTimezone,
  calendarDaysBetween,
  shiftCalendarDateMonths,
} from "./calendar-date";

/**
 * What a tracked unit is. The prep list's eight rental kinds plus the two a
 * fleet has that a fit never mentions: `tank` (the compliance-heavy unit with
 * its own hydro/VIP clocks) and `other` for the odd tagged thing — a torch,
 * an SMB, a camera tray. Keep aligned with the `gear_item_kind` pg enum.
 */
export type GearItemKind =
  | "bcd"
  | "regulator"
  | "wetsuit"
  | "boots"
  | "mask_fins"
  | "weights"
  | "dive_computer"
  | "gopro"
  | "tank"
  | "other";

export type GearItemStatus = "in_service" | "needs_service" | "retired";

/**
 * The clocks a unit can run: manufacturer service, a tank's two independent
 * compliance clocks (DOT hydrostatic test, annual visual inspection), the
 * nitrox O2-clean renewal, and a dated condition note with no clock at all.
 */
export type GearServiceKind = "service" | "hydro_test" | "visual_inspection" | "o2_clean" | "note";

/**
 * Fleet display order. The eight shared kinds keep the prep list's own order
 * (`KIND_ORDER` in dive-prep.ts) so the register and the packing list read
 * the same way; the two register-only kinds follow.
 */
export const GEAR_KIND_ORDER: readonly GearItemKind[] = [
  "bcd",
  "regulator",
  "wetsuit",
  "boots",
  "mask_fins",
  "weights",
  "dive_computer",
  "gopro",
  "tank",
  "other",
];

const GEAR_KIND_RANK = new Map(GEAR_KIND_ORDER.map((kind, index) => [kind, index]));

export function gearKindRank(kind: GearItemKind): number {
  return GEAR_KIND_RANK.get(kind) ?? GEAR_KIND_ORDER.length;
}

/**
 * The conventional renewal interval per clock, in months — what the service
 * form suggests, never what it enforces. Staff always own the date they
 * write: manufacturer intervals genuinely vary (annual vs. two-year regulator
 * service), rental fleets run shorter, and hydro is US DOT's five years.
 * `note` has no clock.
 */
export const GEAR_SERVICE_INTERVAL_MONTHS: Record<GearServiceKind, number | null> = {
  service: 12,
  hydro_test: 60,
  visual_inspection: 12,
  o2_clean: 12,
  note: null,
};

/**
 * Which clocks the service form offers for a unit of each kind. A tank runs
 * compliance clocks and never a "service"; life support and electronics run
 * the manufacturer service; soft goods only ever get condition notes. This
 * bounds nothing at the database layer — it is the form's relevance list.
 */
export const GEAR_SERVICE_KINDS_FOR: Record<GearItemKind, readonly GearServiceKind[]> = {
  bcd: ["service", "note"],
  regulator: ["service", "note"],
  wetsuit: ["note"],
  boots: ["note"],
  mask_fins: ["note"],
  weights: ["note"],
  dive_computer: ["service", "note"],
  gopro: ["note"],
  tank: ["visual_inspection", "hydro_test", "o2_clean", "note"],
  other: ["service", "note"],
};

/** The service-form suggestion: the conventional next deadline for this clock. */
export function suggestNextDueOn(
  kind: GearServiceKind,
  servicedOn: CalendarDate,
): CalendarDate | null {
  const months = GEAR_SERVICE_INTERVAL_MONTHS[kind];
  if (months === null) return null;
  return shiftCalendarDateMonths(servicedOn, months);
}

/** One clock's latest reading: when it last ran and when it next runs out. */
export type GearServiceClock = {
  kind: GearServiceKind;
  servicedOn: CalendarDate;
  nextDueOn: CalendarDate | null;
};

/**
 * A due date within this window reads "due soon" — long enough to catch the
 * next service run, short enough that the warning still means something.
 */
export const GEAR_SERVICE_DUE_SOON_DAYS = 30;

export type GearServiceState =
  | { state: "no_clock" }
  | { state: "ok"; kind: GearServiceKind; nextDueOn: CalendarDate }
  | { state: "due_soon"; kind: GearServiceKind; nextDueOn: CalendarDate; daysLeft: number }
  | { state: "overdue"; kind: GearServiceKind; nextDueOn: CalendarDate; daysOverdue: number };

/**
 * A unit's single most urgent clock, worded as a state. Clocks are
 * independent (a tank's VIP can lapse while its hydro has years left), so the
 * earliest `nextDueOn` wins; clocks with no deadline recorded contribute
 * nothing. Informs, never gates — an overdue unit can still be handed to a
 * diver, because the dock decides, not the software.
 */
export function gearServiceState(
  clocks: readonly GearServiceClock[],
  todayLocal: CalendarDate,
): GearServiceState {
  let earliest: { kind: GearServiceKind; nextDueOn: CalendarDate } | null = null;
  for (const clock of clocks) {
    if (!clock.nextDueOn) continue;
    if (!earliest || clock.nextDueOn < earliest.nextDueOn) {
      earliest = { kind: clock.kind, nextDueOn: clock.nextDueOn };
    }
  }
  if (!earliest) return { state: "no_clock" };
  const days = calendarDaysBetween(todayLocal, earliest.nextDueOn);
  if (days < 0) return { state: "overdue", ...earliest, daysOverdue: -days };
  if (days <= GEAR_SERVICE_DUE_SOON_DAYS) return { state: "due_soon", ...earliest, daysLeft: days };
  return { state: "ok", ...earliest };
}

/** The inclusive shop-local date range a reservation covers. */
export type ReservationWindow = { from: CalendarDate; until: CalendarDate };

/**
 * The window a trip's rental gear is spoken for: the shop-local days the
 * departure spans. A multi-day course holds its kit for the whole run; a
 * morning two-tank holds it for the day.
 */
export function tripReservationWindow(
  trip: { startsAt: Date; endsAt: Date },
  timeZone: string,
): ReservationWindow {
  const from = calendarDateInTimezone(trip.startsAt, timeZone);
  const until = calendarDateInTimezone(trip.endsAt, timeZone);
  return { from, until: until >= from ? until : from };
}

/**
 * Where a reservation is in its life, derived — never stored, so it can
 * never disagree with the rows. `overdue` and `due_back_today` read the
 * shop's own calendar, not the server's.
 *
 * A lapsed window splits on `checkedOutAt`, and the split is load-bearing:
 * `overdue` means the unit is physically out with a diver — a phone call —
 * while `never_picked_up` means it hung on the wall the whole time and the
 * only honest close is a *release*. Collapsing the two would have the
 * register claim a customer has gear they never took, and teach a crew to
 * skim past its loudest rows (dive-domain review, 2026-08-20).
 */
export type GearReservationPhase =
  | "reserved"
  | "out"
  | "due_back_today"
  | "overdue"
  | "never_picked_up"
  | "returned";

export function reservationPhase(
  reservation: {
    checkedOutAt: Date | null;
    returnedAt: Date | null;
    reservedUntil: CalendarDate;
  },
  todayLocal: CalendarDate,
): GearReservationPhase {
  if (reservation.returnedAt) return "returned";
  if (reservation.reservedUntil < todayLocal) {
    return reservation.checkedOutAt ? "overdue" : "never_picked_up";
  }
  if (reservation.reservedUntil === todayLocal) return "due_back_today";
  return reservation.checkedOutAt ? "out" : "reserved";
}

/**
 * Which of a unit's open reservations the register row talks about. A unit
 * can hold several non-overlapping open windows (this weekend's course, next
 * month's charter); the row gets one line, so the most operationally urgent
 * wins: an overdue window first (something is wrong now), then the window
 * covering today, then the nearest upcoming one.
 */
export function pickDisplayReservation<
  T extends { reservedFrom: CalendarDate; reservedUntil: CalendarDate; returnedAt: Date | null },
>(reservations: readonly T[], todayLocal: CalendarDate): T | null {
  const open = reservations.filter((reservation) => !reservation.returnedAt);
  if (open.length === 0) return null;
  const overdue = open
    .filter((reservation) => reservation.reservedUntil < todayLocal)
    .sort((a, b) => a.reservedUntil.localeCompare(b.reservedUntil));
  if (overdue[0]) return overdue[0];
  const sorted = [...open].sort((a, b) => a.reservedFrom.localeCompare(b.reservedFrom));
  const current = sorted.find(
    (reservation) =>
      reservation.reservedFrom <= todayLocal && reservation.reservedUntil >= todayLocal,
  );
  return current ?? sorted[0] ?? null;
}

/**
 * Order candidate units for one diver's kind + size: exact size match first
 * (case-insensitively, sizes being the same free text the fit records), then
 * unsized units, then everything else, each band alphabetical by label so
 * the list reads stably. Ranking only — staff always pick, because a size
 * label matching is not a fit check (H-06).
 */
export function rankUnitsForSize<T extends { label: string; size: string | null }>(
  units: readonly T[],
  wantedSize: string | null,
): T[] {
  const wanted = wantedSize?.trim().toLowerCase() ?? null;
  const band = (unit: T): number => {
    if (!wanted) return unit.size ? 1 : 0;
    const size = unit.size?.trim().toLowerCase() ?? null;
    if (size === wanted) return 0;
    if (!size) return 1;
    return 2;
  };
  return [...units].sort((a, b) => band(a) - band(b) || a.label.localeCompare(b.label));
}
