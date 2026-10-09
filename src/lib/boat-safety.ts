/**
 * **The boat as a machine with papers and an emergency kit** (roadmap N-08 and
 * the paper half of N-10): what a departure's pre-departure check says about
 * the hull it sails on.
 *
 * Three kinds of fact. The papers and the kit inform and never gate — the dock
 * decides, not the software, the same posture as the gear register's service
 * clocks (ADR 20260815-minimal-gear-register) and the pre-departure checklist
 * (ADR 20260824-pre-departure-safety-check). The certificate is the exception
 * since H-107:
 *
 * - **Too many people for the certificate.** A passenger vessel's certificate
 *   (in the US, the Coast Guard's Certificate of Inspection) names a passenger
 *   limit. **No seat above it is sold** (H-107, reversing "informs, never
 *   gates" for this one fact): a boat whose seats on sale pass it is refused
 *   at save (`boatSeatsRefusal`), and so is a departure whose own capacity
 *   does (`tripDetailsPatch`). Capacity and the certificate count the same
 *   people — everyone aboard who is not crew — so they compare directly. When
 *   the people aboard pass it anyway (a hull saved before H-107), the
 *   manifest still says so.
 * - **The boat's papers**: next safety inspection, registration and insurance.
 * - **The safety kit aboard**: O2 kit, AED, first-aid kit and flares are gear
 *   register units (`gear_items`, opt-in by presence) that may be assigned to
 *   one hull, each running its own printed-date clocks — and an O2 kit or AED
 *   the shop keeps but this hull lacks is said too.
 *
 * Pure and framework-free: codes and numbers out, never sentences
 * (`src/i18n/boat-safety-labels.ts` words them).
 */

import { type CalendarDate, calendarDateInTimezone, calendarDaysBetween } from "./calendar-date";
import {
  GEAR_SERVICE_DUE_SOON_DAYS,
  type GearItemKind,
  type GearItemStatus,
  type GearServiceClock,
  type GearServiceKind,
} from "./gear";

/**
 * The register kinds that are the boat's own emergency equipment rather than
 * rental gear. Only these may be assigned aboard a boat
 * (`gear_items.aboard_boat_id`).
 */
export const SAFETY_KIT_KINDS = [
  "o2_kit",
  "aed",
  "first_aid_kit",
  "flares",
] as const satisfies readonly GearItemKind[];

export type SafetyKitKind = (typeof SAFETY_KIT_KINDS)[number];

const SAFETY_KIT = new Set<GearItemKind>(SAFETY_KIT_KINDS);

export function isSafetyKitKind(kind: GearItemKind): kind is SafetyKitKind {
  return SAFETY_KIT.has(kind);
}

/**
 * **The date a departure's boat is judged on**: the departure's own local day,
 * so next week's boat is asked whether its pads are in date next week. Null
 * once that day is behind the shop — a departure that has sailed says nothing
 * about today's kit, and what it sailed with is the departure log's to keep.
 */
export function departureSafetyDate(
  startsAt: Date,
  now: Date,
  timeZone: string,
): CalendarDate | null {
  const onDate = calendarDateInTimezone(startsAt, timeZone);
  return onDate < calendarDateInTimezone(now, timeZone) ? null : onDate;
}

/**
 * The kit a boat cannot sail well without and that the crew reach for in the
 * first minutes of an emergency: oxygen, the AED and the means to call for
 * help. These are the kinds Today raises on a departure sailing today; a
 * first-aid kit's lapse stays the owner's errand.
 */
export const LIFE_SAFETY_KIT_KINDS = [
  "o2_kit",
  "aed",
  "flares",
] as const satisfies readonly SafetyKitKind[];

export type LifeSafetyKitKind = (typeof LIFE_SAFETY_KIT_KINDS)[number];

const LIFE_SAFETY_KIT = new Set<GearItemKind>(LIFE_SAFETY_KIT_KINDS);

export function isLifeSafetyKitKind(kind: GearItemKind): kind is LifeSafetyKitKind {
  return LIFE_SAFETY_KIT.has(kind);
}

/**
 * The kinds whose **absence** is itself a notice: a shop that keeps an O2 kit
 * or an AED on its register expects one aboard every boat that sails, so a
 * hull with none in service aboard — pulled to the bench, deleted, moved to
 * the other boat — says so. Opt-in by presence: a shop with no AED on the
 * register is never told a boat lacks one.
 */
export const MUST_CARRY_KIT_KINDS = ["o2_kit", "aed"] as const satisfies readonly SafetyKitKind[];

export type MustCarryKitKind = (typeof MUST_CARRY_KIT_KINDS)[number];

/**
 * How far ahead the kit check looks: the register's own "due soon" window, so
 * a unit that reads due on the gear page reads due on the boat too.
 */
export const BOAT_SAFETY_HORIZON_DAYS = GEAR_SERVICE_DUE_SOON_DAYS;

/** The boat's three paper clocks. */
export const BOAT_PAPERS = ["inspection", "registration", "insurance"] as const;
export type BoatPaper = (typeof BOAT_PAPERS)[number];

/**
 * How far ahead each paper is said, longer than the kit's: booking an
 * inspection or renewing a policy takes weeks of lead time, where new pads are
 * a parcel. A paper inside its window is an owner's errand on Today and a line
 * on the manifest; past its date it escalates.
 */
export const BOAT_PAPER_HORIZON_DAYS: Record<BoatPaper, number> = {
  inspection: 90,
  registration: 60,
  insurance: 60,
};

export type BoatPaperDates = {
  inspectionDueOn: CalendarDate | null;
  registrationExpiresOn: CalendarDate | null;
  insuranceExpiresOn: CalendarDate | null;
};

/** One unit of safety kit and its latest clock readings (`latestServiceClocks`). */
export type SafetyKitUnit = {
  id: string;
  label: string;
  kind: GearItemKind;
  status: GearItemStatus;
  clocks: readonly GearServiceClock[];
};

/**
 * One thing worth saying before the boat leaves. `days` is always a count
 * from today: days left while not `expired` (0 on the last good day), days
 * since once it is.
 */
export type BoatSafetyNotice =
  /**
   * More people than the certificate allows. `counted` once the crew have
   * started recording people aboard at the departure checkpoint — then
   * `passengers` is the people recorded aboard, before it the people booked.
   */
  | { code: "over_certificate"; passengers: number; limit: number; counted: boolean }
  /** No in-service unit of a must-carry kind aboard, on a shop that keeps one. */
  | { code: "kit_missing"; kind: MustCarryKitKind }
  | { code: "paper"; paper: BoatPaper; dueOn: CalendarDate; expired: boolean; days: number }
  | {
      code: "kit_clock";
      gearItemId: string;
      label: string;
      kind: GearItemKind;
      clock: GearServiceKind;
      dueOn: CalendarDate;
      expired: boolean;
      days: number;
    }
  | { code: "kit_off_service"; gearItemId: string; label: string; kind: GearItemKind };

/**
 * A dated clock's reading against today, or null when it is past the horizon.
 * The printed date is the last good day: on it the pads are still in date, and
 * the day after they are not — the same boundary `gearServiceState` draws.
 */
function dated(dueOn: CalendarDate, onDate: CalendarDate, horizonDays: number) {
  const days = calendarDaysBetween(onDate, dueOn);
  if (days < 0) return { expired: true, days: -days };
  if (days <= horizonDays) return { expired: false, days };
  return null;
}

/**
 * Every clock on every unit that has run out or will inside the horizon — one
 * notice per clock, not per unit, because an AED's pads and battery are
 * replaced on their own schedules and naming only the worse one leaves a crew
 * believing the other is fine. A unit pulled to the bench is said to be off
 * the boat, whatever its clocks read.
 *
 * Date clocks only: safety kit is not rented, so it has no dive count.
 */
export function safetyKitNotices(
  units: readonly SafetyKitUnit[],
  onDate: CalendarDate,
): BoatSafetyNotice[] {
  const notices: BoatSafetyNotice[] = [];
  for (const unit of units) {
    if (unit.status !== "in_service") {
      notices.push({
        code: "kit_off_service",
        gearItemId: unit.id,
        label: unit.label,
        kind: unit.kind,
      });
    }
    for (const clock of unit.clocks) {
      if (!clock.nextDueOn) continue;
      const reading = dated(clock.nextDueOn, onDate, BOAT_SAFETY_HORIZON_DAYS);
      if (!reading) continue;
      notices.push({
        code: "kit_clock",
        gearItemId: unit.id,
        label: unit.label,
        kind: unit.kind,
        clock: clock.kind,
        dueOn: clock.nextDueOn,
        ...reading,
      });
    }
  }
  return notices.sort(byUrgency);
}

const PAPER_DATES: Record<BoatPaper, keyof BoatPaperDates> = {
  inspection: "inspectionDueOn",
  registration: "registrationExpiresOn",
  insurance: "insuranceExpiresOn",
};

/**
 * The must-carry kinds this hull has none of, in service, aboard. `kindsOnRegister`
 * is every kind the shop has at least one live unit of, anywhere: the opt-in.
 * A unit flagged for service does not count — it may be on the bench.
 */
export function kitMissingNotices(
  aboard: readonly Pick<SafetyKitUnit, "kind" | "status">[],
  kindsOnRegister: ReadonlySet<GearItemKind>,
): BoatSafetyNotice[] {
  return MUST_CARRY_KIT_KINDS.filter(
    (kind) =>
      kindsOnRegister.has(kind) &&
      !aboard.some((unit) => unit.kind === kind && unit.status === "in_service"),
  ).map((kind) => ({ code: "kit_missing", kind }));
}

/** The boat's papers that have run out or will inside each paper's own horizon. */
export function boatPaperNotices(papers: BoatPaperDates, onDate: CalendarDate): BoatSafetyNotice[] {
  const notices: BoatSafetyNotice[] = [];
  for (const paper of BOAT_PAPERS) {
    const dueOn = papers[PAPER_DATES[paper]];
    if (!dueOn) continue;
    const reading = dated(dueOn, onDate, BOAT_PAPER_HORIZON_DAYS[paper]);
    if (reading) notices.push({ code: "paper", paper, dueOn, ...reading });
  }
  return notices.sort(byUrgency);
}

/**
 * More people booked aboard than the certificate allows. A boat with no
 * certificate number recorded has said nothing, and is never over it.
 */
export function passengersAboveCertificate(
  passengers: number,
  certifiedPassengers: number | null,
): boolean {
  return certifiedPassengers !== null && passengers > certifiedPassengers;
}

/**
 * **Why a boat's numbers may not be saved** (H-107), or null when they may.
 *
 * - `seats_above_certificate`: the seats on sale (`capacity`) pass the
 *   certificate's passenger limit. One code for both directions — raising the
 *   seats, or lowering the certificate under them — because the fix is the
 *   same pair of boxes either way.
 * - `departures_above_certificate`: the hull is fine, but upcoming
 *   departures on it still sell more seats than the certificate allows. A
 *   departure's seats are its own number (`trips.capacity`), and lowering the
 *   certificate under one would leave a sale nobody refused.
 *
 * A boat with no certificate recorded is never refused. **A row already over
 * the limit keeps working** — it sails, its manifest says so, its fleet row
 * says so in danger ink — but its next save must fix it, because this runs on
 * every save of the row.
 */
export type BoatSeatsRefusal =
  | { code: "seats_above_certificate"; capacity: number; limit: number }
  | { code: "departures_above_certificate"; departures: number; limit: number };

export function boatSeatsRefusal(input: {
  capacity: number;
  certifiedPassengers: number | null;
  /** The capacities of the hull's upcoming, live, scheduled departures. */
  upcomingDepartureCapacities?: readonly number[];
}): BoatSeatsRefusal | null {
  const limit = input.certifiedPassengers;
  if (limit === null) return null;
  if (passengersAboveCertificate(input.capacity, limit)) {
    return { code: "seats_above_certificate", capacity: input.capacity, limit };
  }
  const departures = (input.upcomingDepartureCapacities ?? []).filter((seats) =>
    passengersAboveCertificate(seats, limit),
  ).length;
  return departures > 0 ? { code: "departures_above_certificate", departures, limit } : null;
}

/**
 * Everything the pre-departure check says about this departure's boat, most
 * urgent first: must-carry kit missing, too many people aboard, then what has
 * already run out (the longest-expired leading), then kit flagged for service,
 * then what is about to run out (the soonest leading).
 *
 * `onDate` is **the departure's own local date**, not today's: a boat sailing
 * next week is judged by whether its pads are in date next week.
 */
export function boatSafetyNotices(input: {
  boat: BoatPaperDates & { certifiedPassengers: number | null };
  /** The live safety-kit units assigned aboard this hull. */
  kit: readonly SafetyKitUnit[];
  /** Every kind the shop has at least one live unit of, aboard any hull or ashore. */
  kindsOnRegister: ReadonlySet<GearItemKind>;
  /**
   * The people on the departure list (divers and non-divers alike, crew
   * excluded), and how many the crew have recorded aboard at the departure
   * checkpoint so far (0 before boarding starts).
   */
  passengers: { booked: number; boarded: number };
  onDate: CalendarDate;
}): BoatSafetyNotice[] {
  const notices: BoatSafetyNotice[] = [
    ...kitMissingNotices(input.kit, input.kindsOnRegister),
    ...boatPaperNotices(input.boat, input.onDate),
    ...safetyKitNotices(input.kit, input.onDate),
  ];
  const limit = input.boat.certifiedPassengers;
  if (limit !== null) {
    const { booked, boarded } = input.passengers;
    // The bodies the crew have counted aboard are the fact once there are more
    // of them than the certificate allows; until then the list says it, so the
    // line does not vanish halfway up the gangway.
    if (passengersAboveCertificate(boarded, limit)) {
      notices.push({ code: "over_certificate", passengers: boarded, limit, counted: true });
    } else if (passengersAboveCertificate(booked, limit)) {
      notices.push({ code: "over_certificate", passengers: booked, limit, counted: false });
    }
  }
  return notices.sort(byUrgency);
}

/**
 * The notices Today raises **on a departure sailing today** (danger, every
 * role): a must-carry kind missing, and any clock on oxygen, the AED or flares
 * aboard that has run out or will inside the kit horizon.
 */
export function lifeSafetyNotices(notices: readonly BoatSafetyNotice[]): BoatSafetyNotice[] {
  return notices.filter(
    (notice) =>
      notice.code === "kit_missing" ||
      (notice.code === "kit_clock" && isLifeSafetyKitKind(notice.kind)),
  );
}

/**
 * Only what has already run out — the owner's errand row on Today. The
 * certificate is left out on purpose: it is one departure's fact and its
 * manifest says it.
 */
export function expiredBoatSafetyNotices(notices: readonly BoatSafetyNotice[]): BoatSafetyNotice[] {
  return notices.filter(
    (notice) => (notice.code === "paper" || notice.code === "kit_clock") && notice.expired,
  );
}

export type BoatSafetyTone = "danger" | "warning" | "neutral";

/**
 * The section as a reader sees it, worded (`boatSafetySection`,
 * src/i18n/boat-safety-labels.ts): what the live manifest renders and the
 * offline copy carries, so the dock with no signal reads the same lines.
 */
export type BoatSafetySection = {
  heading: string;
  lines: { text: string; tone: BoatSafetyTone }[];
};

/**
 * How loudly a notice is drawn. **Danger** for the two that mean the boat is
 * not as it should be to leave: must-carry kit missing, and more people than
 * the certificate allows. **Warning** for what has already gone wrong (a
 * lapsed date, kit flagged for service). **Neutral** for a heads-up.
 */
export function boatSafetyNoticeTone(notice: BoatSafetyNotice): BoatSafetyTone {
  if (notice.code === "over_certificate" || notice.code === "kit_missing") return "danger";
  if (notice.code === "kit_off_service") return "warning";
  return notice.expired ? "warning" : "neutral";
}

/** Whether a notice is something that has already gone wrong rather than a heads-up. */
export function boatSafetyNoticeIsUrgent(notice: BoatSafetyNotice): boolean {
  return boatSafetyNoticeTone(notice) !== "neutral";
}

function rank(notice: BoatSafetyNotice): number {
  if (notice.code === "kit_missing") return 0;
  if (notice.code === "over_certificate") return 1;
  if (notice.code === "kit_off_service") return 3;
  return notice.expired ? 2 : 4;
}

function byUrgency(a: BoatSafetyNotice, b: BoatSafetyNotice): number {
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  if (
    (a.code === "paper" || a.code === "kit_clock") &&
    (b.code === "paper" || b.code === "kit_clock")
  ) {
    // Longest-expired first among the expired; soonest first among the rest.
    return a.expired ? b.days - a.days : a.days - b.days;
  }
  return 0;
}
