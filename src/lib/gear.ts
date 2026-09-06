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
import type { RentalItemKind } from "./dive-prep";

/**
 * What a tracked unit is. The prep list's eight rental kinds plus the physical
 * mask and fins units and register-only
 * fleet categories. Register-only kinds never become rental-fit options until
 * a separate product decision says they should. Keep aligned with the
 * `gear_item_kind` pg enum.
 */
export type GearItemKind =
  | "bcd"
  | "regulator"
  | "wetsuit"
  | "boots"
  | "mask"
  | "fins"
  | "weights"
  | "dive_computer"
  | "gopro"
  | "tank"
  | "drysuit"
  | "hood"
  | "gloves"
  | "torch"
  | "dpv"
  | "smb"
  | "reel"
  | "camera"
  | "nitrox_analyzer"
  | "o2_kit"
  | "other";

/**
 * Whether a unit is on the wall or off it for bench work. A unit the shop is
 * finished with is deleted (soft, `gear_items.deleted_at`) — there is no
 * third state and no "retired" (ADR 20260820-every-delete-is-soft).
 */
/**
 * Every gear status, as a list — for a caller that must render all of them
 * exhaustively rather than ask one at a time (`gearStatusLabels`). The union
 * below is derived from it, so adding a status here is a compile error at every
 * exhaustive map rather than a silently missing word.
 */
export const GEAR_ITEM_STATUSES = ["in_service", "needs_service"] as const;

export type GearItemStatus = (typeof GEAR_ITEM_STATUSES)[number];

/**
 * The clocks a unit can run: manufacturer service, a tank's two independent
 * compliance clocks (DOT hydrostatic test, annual visual inspection), the
 * nitrox O2-clean renewal, and a dated condition note with no clock at all.
 */
export type GearServiceKind = "service" | "hydro_test" | "visual_inspection" | "o2_clean" | "note";

/**
 * Fleet display order. The four shared kinds before mask/fins keep the prep
 * list's own order
 * (`KIND_ORDER` in dive-prep.ts) so the register and the packing list read
 * the same way; register-only categories follow, with `other` last as the
 * genuine catch-all.
 */
export const GEAR_KIND_ORDER: readonly GearItemKind[] = [
  "bcd",
  "regulator",
  "wetsuit",
  "boots",
  "mask",
  "fins",
  "weights",
  "dive_computer",
  "gopro",
  "tank",
  "drysuit",
  "hood",
  "gloves",
  "torch",
  "dpv",
  "smb",
  "reel",
  "camera",
  "nitrox_analyzer",
  "o2_kit",
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
  mask: ["note"],
  fins: ["note"],
  weights: ["note"],
  dive_computer: ["service", "note"],
  gopro: ["note"],
  tank: ["visual_inspection", "hydro_test", "o2_clean", "note"],
  drysuit: ["note"],
  hood: ["note"],
  gloves: ["note"],
  torch: ["service", "note"],
  dpv: ["service", "note"],
  smb: ["note"],
  reel: ["note"],
  camera: ["note"],
  nitrox_analyzer: ["service", "note"],
  o2_kit: ["service", "note"],
  other: ["service", "note"],
};

/** A physical register demand derived from one rental-fit piece. */
export type GearAssignmentNeed = {
  kind: GearItemKind;
  size: string | null;
};

/**
 * Bridges the fit's combined mask-and-fins answer to the register's physical
 * units. The diver still answers one rental-fit question and the public
 * packing list still says "mask & fins", but staff must be able to reserve the
 * two tagged things independently (issue #953).
 */
export function gearAssignmentNeeds(
  piece: Pick<{ kind: RentalItemKind; size: string | null }, "kind" | "size">,
): GearAssignmentNeed[] {
  if (piece.kind === "mask_fins") {
    return [
      { kind: "mask", size: null },
      { kind: "fins", size: piece.size },
    ];
  }
  // The same split, one item over: a diver ticks "hood & gloves" once and the
  // register holds a hood and a pair of gloves as separate tagged units.
  // Neither carries a size in the fit.
  if (piece.kind === "hood_gloves") {
    return [
      { kind: "hood", size: null },
      { kind: "gloves", size: null },
    ];
  }
  return [
    { kind: piece.kind as Exclude<RentalItemKind, "mask_fins" | "hood_gloves">, size: piece.size },
  ];
}

/** The service-form suggestion: the conventional next deadline for this clock. */
export function suggestNextDueOn(
  kind: GearServiceKind,
  servicedOn: CalendarDate,
): CalendarDate | null {
  const months = GEAR_SERVICE_INTERVAL_MONTHS[kind];
  if (months === null) return null;
  return shiftCalendarDateMonths(servicedOn, months);
}

/**
 * One clock's latest reading: when it last ran, when it next runs out, and —
 * for the units a shop dual-clocks — how many dives it has left.
 *
 * Manufacturers publish both numbers and mean "whichever comes first"
 * (ScubaPro: 24 months **or** 100 dives), and a rental regulator in season
 * reaches the dive count long before the date. `nextDueDives` is that second
 * interval; `divesSince` is what this shop has actually recorded against the
 * unit since `servicedOn`.
 *
 * **`divesSince` is a floor, never a fact.** It is derived from returned
 * reservations joined to their departures' planned dives — records staff keep
 * as well as they keep them — so a unit that went out on a handshake counts as
 * zero. Every surface that shows it says "at least", and nothing gates on it.
 */
export type GearServiceClock = {
  kind: GearServiceKind;
  servicedOn: CalendarDate;
  nextDueOn: CalendarDate | null;
  /** The dive interval for this clock, when the shop recorded one with it. */
  nextDueDives?: number | null;
  /** Dives recorded against this unit since `servicedOn`. A floor — see above. */
  divesSince?: number | null;
};

/**
 * A due date within this window reads "due soon" — long enough to catch the
 * next service run, short enough that the warning still means something.
 */
export const GEAR_SERVICE_DUE_SOON_DAYS = 30;

/**
 * The dive-clock twin of {@link GEAR_SERVICE_DUE_SOON_DAYS}. Ten dives is about
 * a busy fortnight for one rental unit — the same "catch the next service run"
 * distance the day window is picked for, measured in the other currency.
 */
export const GEAR_SERVICE_DUE_SOON_DIVES = 10;

/**
 * How far through the dive interval a unit is, when the shop set one. Carried
 * beside the date so a surface can say which clock ran out — "at least 104 of
 * 100 dives" is a different conversation from "due last Tuesday", and a crew
 * that gets told the wrong one goes looking for the wrong paperwork.
 */
export type GearServiceDives = { since: number; due: number };

export type GearServiceState =
  | { state: "no_clock" }
  | { state: "ok"; kind: GearServiceKind; nextDueOn: CalendarDate; dives?: GearServiceDives }
  | {
      state: "due_soon";
      kind: GearServiceKind;
      nextDueOn: CalendarDate;
      daysLeft: number;
      dives?: GearServiceDives;
    }
  | {
      state: "overdue";
      kind: GearServiceKind;
      nextDueOn: CalendarDate;
      daysOverdue: number;
      dives?: GearServiceDives;
    };

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
  let worst: GearServiceState | null = null;
  for (const clock of clocks) {
    const state = clockState(clock, todayLocal);
    if (!state) continue;
    if (!worst || outranks(state, worst)) worst = state;
  }
  return worst ?? { state: "no_clock" };
}

/** One clock's own verdict, taking whichever of its two intervals bites first. */
function clockState(clock: GearServiceClock, todayLocal: CalendarDate): GearServiceState | null {
  if (!clock.nextDueOn) return null;
  const base = { kind: clock.kind, nextDueOn: clock.nextDueOn };
  const days = calendarDaysBetween(todayLocal, clock.nextDueOn);
  const byDate: GearServiceState =
    days < 0
      ? { state: "overdue", ...base, daysOverdue: -days }
      : days <= GEAR_SERVICE_DUE_SOON_DAYS
        ? { state: "due_soon", ...base, daysLeft: days }
        : { state: "ok", ...base };

  // The dive clock only ever *escalates*. A unit under its dive count is not
  // thereby fine — its date may still have passed — and a shop that records a
  // dive interval has said "whichever comes first", not "instead of".
  const due = clock.nextDueDives;
  const since = clock.divesSince;
  if (!due || since === null || since === undefined) return byDate;
  const dives: GearServiceDives = { since, due };
  const byDives: GearServiceState =
    since >= due
      ? { state: "overdue", ...base, daysOverdue: Math.max(0, -days), dives }
      : since >= due - GEAR_SERVICE_DUE_SOON_DIVES
        ? { state: "due_soon", ...base, daysLeft: Math.max(0, days), dives }
        : byDate;
  // When both clocks land on the same verdict the dive one carries the numbers,
  // because it is the one the reader cannot work out from a calendar.
  return outranks(byDives, byDate) || byDives.state === byDate.state ? byDives : byDate;
}

const URGENCY = { no_clock: 0, ok: 1, due_soon: 2, overdue: 3 } as const;

/** True when `a` is the more urgent of the two, earliest deadline breaking a tie. */
function outranks(a: GearServiceState, b: GearServiceState): boolean {
  if (URGENCY[a.state] !== URGENCY[b.state]) return URGENCY[a.state] > URGENCY[b.state];
  if (a.state === "no_clock" || b.state === "no_clock") return false;
  return a.nextDueOn < b.nextDueOn;
}

/**
 * **The unit is due for service** — pulled to the bench, or a clock that has
 * run out or is about to. One predicate rather than two, because the register
 * says this fact in two places and they must agree by construction: the row's
 * service sentence speaks exactly when this is true (`serviceFact` in
 * `GearRegisterLedger.tsx`), and the register's Service-due view lists exactly
 * the units for which it is (`listGearServiceDueRows`, `src/db/gear.ts`). A
 * chip counting one set over a list built from another is how a heading starts
 * lying, which is the whole failure slice 9d's groups exist to end.
 *
 * The 30-day window is not applied here: {@link gearServiceState} has already
 * spent {@link GEAR_SERVICE_DUE_SOON_DAYS} deciding that `due_soon` means
 * "inside the next service run". Today's queue narrows further to six days on
 * its own (`src/db/today.ts`) because it is a *today* list; the register is
 * where the month-ahead heads-up lives, and a tank's hydro or visual
 * inspection is a compliance clock a fill station enforces, so losing that
 * distance costs a boat its air.
 *
 * Informs, never gates (ADR 20260815-minimal-gear-register) — this decides
 * what a row *says*, never whether a unit may dive.
 */
export function gearServiceIsDue(
  item: { status: GearItemStatus },
  serviceState: GearServiceState,
): boolean {
  if (item.status !== "in_service") return true;
  return serviceState.state === "due_soon" || serviceState.state === "overdue";
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
 * The three groups the register tells its one story in — ADR
 * 20260827-the-shops-shelves, slice 9d: **Out**, **Overdue**, **On the wall**.
 * The states *are* the groups, which is what let the three stat tiles and the
 * separate returns panel go: each of them was a second rendering of a fact a
 * group heading now owns.
 */
export type GearRegisterGroupName = "out" | "overdue" | "onWall";

/**
 * Which group a unit is filed under, from the reservation its row talks about
 * ({@link pickDisplayReservation}). Every {@link GearReservationPhase} maps to
 * exactly one group, so a unit can never appear twice or vanish between them —
 * the pin the roadmap names for this slice, held by `gear.test.ts`.
 *
 * Two of the mappings are deliberate widenings of the phase vocabulary:
 *
 * - **A lapsed window is overdue whether or not the unit ever left.** The
 *   `overdue`/`never_picked_up` split stays load-bearing (a phone call vs. a
 *   release — dive-domain review, 2026-08-20), but it survives as the row's
 *   word and act rather than as a fourth group nobody would scan.
 * - **Reserved-but-never-collected sits in Out**, not on the wall, once its
 *   window has begun. The acts belong where the desk works the reservation,
 *   and the row's own "not collected" word corrects the count a boat-rigger
 *   would otherwise read off the heading.
 */
export function gearRegisterGroup(
  reservation: {
    reservedFrom: CalendarDate;
    reservedUntil: CalendarDate;
    checkedOutAt: Date | null;
    returnedAt: Date | null;
  } | null,
  todayLocal: CalendarDate,
): GearRegisterGroupName {
  if (!reservation) return "onWall";
  switch (reservationPhase(reservation, todayLocal)) {
    case "overdue":
    case "never_picked_up":
      return "overdue";
    case "out":
    case "due_back_today":
      return "out";
    case "reserved":
      // `reserved` covers both "spoken for next Saturday" and "the window is
      // open and nobody has collected it" — only the start date separates them.
      return reservation.reservedFrom <= todayLocal ? "out" : "onWall";
    case "returned":
      return "onWall";
  }
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

/**
 * The same ordering, **cut into the two groups a picker renders as its own
 * headings**: the units that are exactly the size this diver asked for, and
 * everything else that is free.
 *
 * A flat sorted list was ranking the right answer to the top and then asking a
 * staffer to work out where the right answers stopped — on a rack of sixteen
 * free BCDs, "XL" and "L" are one character apart in a dropdown at a counter
 * on the morning of a departure. The split states the boundary the sort was
 * only implying.
 *
 * `exact` is empty when the fit records no size at all, which is the honest
 * answer: with nothing asked for, nothing can match it, and every free unit is
 * equally a candidate. Ranking, never a fit check — staff always pick (H-06).
 */
export function groupUnitsForSize<T extends { label: string; size: string | null }>(
  units: readonly T[],
  wantedSize: string | null,
): { exact: T[]; rest: T[] } {
  const wanted = wantedSize?.trim().toLowerCase() ?? null;
  const ranked = rankUnitsForSize(units, wantedSize);
  if (!wanted) return { exact: [], rest: ranked };
  const exact: T[] = [];
  const rest: T[] = [];
  for (const unit of ranked) {
    (unit.size?.trim().toLowerCase() === wanted ? exact : rest).push(unit);
  }
  return { exact, rest };
}

/**
 * **How a rental set came home**, in the order a counter reads them (issue
 * #1186, delight report D26).
 *
 * "All good" first and by a distance: it is the answer for almost every set,
 * and the whole point of the pane is that the ordinary evening costs one tap.
 * The two exceptions follow, and they are the only ones that open a further
 * field — a service concern must carry words a technician can act on, which
 * `returnTripGearSet` enforces rather than the form.
 *
 * Framework-free and shared, so the pg enum, the action's schema and the
 * buttons cannot drift into three different lists.
 */
export const GEAR_RETURN_OUTCOMES = ["all_good", "fit_adjusted", "service_concern"] as const;
export type GearReturnOutcome = (typeof GEAR_RETURN_OUTCOMES)[number];

/** The one outcome that asks for words before it will be written. */
export function gearReturnOutcomeNeedsNote(outcome: string): boolean {
  return outcome === "service_concern";
}
