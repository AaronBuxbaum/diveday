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
 * - **Too many persons for the certificate, crew included** (#2302). Some
 *   certificates print a total-persons limit beside the passenger one, and
 *   some print only that. Checked at the manifest beside the passenger line,
 *   never at the point of sale: the booking transaction counts seats as it
 *   always has (Aaron, 2026-10-13).
 * - **The boat's papers**: the certificate's own expiry, next safety
 *   inspection, registration and insurance.
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

/**
 * The boat's four paper clocks. `coi` is the certificate's own expiry, kept
 * apart from the annual inspection (#2302): a Certificate of Inspection runs
 * for years, and either one lapsing grounds the boat.
 */
export const BOAT_PAPERS = ["coi", "inspection", "registration", "insurance"] as const;
export type BoatPaper = (typeof BOAT_PAPERS)[number];

/**
 * How far ahead each paper is said, longer than the kit's: booking an
 * inspection or renewing a policy takes weeks of lead time, where new pads are
 * a parcel. A paper inside its window is an owner's errand on Today and a line
 * on the manifest; past its date it escalates to danger ink (H-136), and still
 * gates nothing.
 */
export const BOAT_PAPER_HORIZON_DAYS: Record<BoatPaper, number> = {
  coi: 90,
  inspection: 90,
  registration: 60,
  insurance: 60,
};

export type BoatPaperDates = {
  coiExpiresOn: CalendarDate | null;
  inspectionDueOn: CalendarDate | null;
  registrationExpiresOn: CalendarDate | null;
  insuranceExpiresOn: CalendarDate | null;
};

/**
 * The boat's certificate limits and paper dates verbatim, as the departure log
 * keeps them at the departure checkpoint (#2300). Null is "not recorded".
 */
export type BoatPaperRecord = BoatPaperDates & {
  certifiedPassengers: number | null;
  certifiedTotalPersons: number | null;
};

/**
 * **The boat's radio identity as the emergency card printed it** (records
 * review S1 of #2672): call sign, MMSI and working channel, kept beside the
 * papers at the departure checkpoint so what the card said can be read back.
 * Null is "not recorded".
 */
/**
 * **The pre-departure checklist as it stood at the boat snapshot** (#2725):
 * how many lines the shop's checklist had for this departure and the wording
 * of each line not checked at that instant, kept in the same record as the
 * kit notices so the log can set the crew's answer beside what the gear
 * register showed and the two describe one moment. `itemCount` 0 means the
 * shop kept no checklist then.
 */
export type BoatChecklistAnswer = {
  itemCount: number;
  unchecked: string[];
};

export type BoatRadioRecord = {
  callSign: string | null;
  mmsi: string | null;
  workingChannel: string | null;
};

export const EMPTY_BOAT_RADIO_RECORD: BoatRadioRecord = {
  callSign: null,
  mmsi: null,
  workingChannel: null,
};

/** Whether a kept radio record holds any fact at all. */
export function boatRadioRecorded(radio: BoatRadioRecord | null | undefined): boolean {
  return Boolean(radio && (radio.callSign || radio.mmsi || radio.workingChannel));
}

/** The six certificate and paper fields a boat save can change, in the fleet row's order. */
export const BOAT_PAPER_FIELDS = [
  "certifiedPassengers",
  "certifiedTotalPersons",
  "coiExpiresOn",
  "inspectionDueOn",
  "registrationExpiresOn",
  "insuranceExpiresOn",
] as const satisfies readonly (keyof BoatPaperRecord)[];

export type BoatPaperField = (typeof BOAT_PAPER_FIELDS)[number];

/**
 * **What a boat save changed on the certificate and papers** (records review
 * 2), one entry per field whose value moved, old and new as written ("none"
 * for a value not recorded). `before` null is a new boat.
 */
export function boatPaperChanges(
  before: BoatPaperRecord | null,
  after: BoatPaperRecord,
): { field: BoatPaperField; from: string; to: string }[] {
  const written = (value: number | string | null) => (value === null ? "none" : String(value));
  return BOAT_PAPER_FIELDS.flatMap((field) => {
    const from = before ? before[field] : null;
    const to = after[field];
    return from === to ? [] : [{ field, from: written(from), to: written(to) }];
  });
}

/**
 * The notices a departure-checkpoint snapshot keeps (#2300): papers and kit,
 * never the head-count lines, which the roll call itself records.
 */
export function boatSnapshotNotices(notices: readonly BoatSafetyNotice[]): BoatSafetyNotice[] {
  return notices.filter(
    (notice) => notice.code !== "over_certificate" && notice.code !== "over_total_persons",
  );
}

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
  /**
   * More persons than the certificate's total-persons limit, crew included
   * (#2302). `counted` as above: the people and crew recorded aboard at the
   * departure checkpoint once they pass it, before that the list.
   */
  | { code: "over_total_persons"; persons: number; limit: number; counted: boolean }
  /** No in-service unit of a must-carry kind aboard, on a shop that keeps one. */
  | { code: "kit_missing"; kind: MustCarryKitKind }
  | {
      code: "paper";
      paper: BoatPaper;
      dueOn: CalendarDate;
      expired: boolean;
      days: number;
      /**
       * Lapsed on the date it is judged on, a later departure's, while still
       * good today: it *ends* before the boat sails, it has not *ended*.
       */
      beforeDeparture?: true;
    }
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
  coi: "coiExpiresOn",
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

/**
 * A paper's reading on `onDate`. Hull insurance lapses **on** its expiry date,
 * because a marine policy's cover ends that day; registration and the
 * inspection are good through theirs, like the kit's printed dates.
 */
function paperLapsed(paper: BoatPaper, dueOn: CalendarDate, onDate: CalendarDate) {
  const days = calendarDaysBetween(onDate, dueOn);
  if (paper === "insurance" && days === 0) return { expired: true, days: 0 };
  return dated(dueOn, onDate, BOAT_PAPER_HORIZON_DAYS[paper]);
}

/**
 * The boat's papers that have run out or will inside each paper's own horizon,
 * judged on `onDate`. `today` is the shop's own date when that is a later
 * departure's, so a paper still good today is said to end before it sails.
 */
export function boatPaperNotices(
  papers: BoatPaperDates,
  onDate: CalendarDate,
  today: CalendarDate = onDate,
): BoatSafetyNotice[] {
  const notices: BoatSafetyNotice[] = [];
  for (const paper of BOAT_PAPERS) {
    const dueOn = papers[PAPER_DATES[paper]];
    if (!dueOn) continue;
    const reading = paperLapsed(paper, dueOn, onDate);
    if (!reading) continue;
    const goodToday = !paperLapsed(paper, dueOn, today)?.expired;
    notices.push({
      code: "paper",
      paper,
      dueOn,
      ...reading,
      ...(reading.expired && goodToday ? { beforeDeparture: true as const } : {}),
    });
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
 * **The people the crew have counted aboard, past the certificate** — the
 * manifest's head count turns danger with it. Passengers only, the same
 * population the certificate and every seat number count: divers, snorkelers
 * and riders a crew member marked boarded, never the crew. Null within the
 * limit, and for a boat with no certificate recorded (or none known to the
 * caller), which has said nothing. A warning only: nothing refuses a person
 * the crew is looking at.
 */
export function passengersAboveCertificateAboard(
  aboard: number,
  certifiedPassengers: number | null | undefined,
): { aboard: number; limit: number } | null {
  if (certifiedPassengers == null) return null;
  return passengersAboveCertificate(aboard, certifiedPassengers)
    ? { aboard, limit: certifiedPassengers }
    : null;
}

/**
 * **Everyone counted aboard against the certificate's total persons** (#2302,
 * dive-domain review D2): passengers and crew the roll call recorded aboard at
 * this checkpoint. Null with no total recorded. Informs only: nothing on the
 * boarding path refuses on it, and no seat on sale is capped by it.
 */
export function personsAboveTotalPersonsAboard(
  aboard: number,
  certifiedTotalPersons: number | null | undefined,
): { aboard: number; limit: number } | null {
  if (certifiedTotalPersons == null) return null;
  return aboard > certifiedTotalPersons ? { aboard, limit: certifiedTotalPersons } : null;
}

/**
 * The crew half of the total-persons count (#2302), off the departure
 * checkpoint's crew list: everyone named for the boat, and those the crew roll
 * call has recorded aboard. A crew member recorded ashore still counts as
 * named until somebody takes them off the departure; the boarded count is the
 * one that switches the line to "aboard".
 */
export function departureCrewCount(crew: readonly { rollCall?: { state: string } | null }[]): {
  assigned: number;
  boarded: number;
} {
  return {
    assigned: crew.length,
    boarded: crew.filter((member) => member.rollCall?.state === "boarded").length,
  };
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
  /**
   * More passengers than persons on the certificate (#2302): passengers are
   * some of the persons aboard, so this is a typo in one of the two boxes.
   */
  | { code: "passengers_above_total_persons"; passengers: number; limit: number }
  /**
   * More seats than persons on the certificate (dive-domain review D2): a typo
   * at save, refused like the one above. Caps no sale.
   */
  | { code: "seats_above_total_persons"; capacity: number; limit: number }
  | { code: "seats_above_certificate"; capacity: number; limit: number }
  | {
      code: "departures_above_certificate";
      departures: number;
      limit: number;
      /** The first few of them, soonest first, so the refusal can name them. */
      firstDates: string[];
    };

/** How many over-limit departures the refusal names by date. */
export const NAMED_DEPARTURES = 3;

export function boatSeatsRefusal(input: {
  capacity: number;
  certifiedPassengers: number | null;
  /**
   * Total persons, crew included (#2302). Only ever compared with the
   * passenger figure: it caps no seat on sale.
   */
  certifiedTotalPersons?: number | null;
  /**
   * The hull's upcoming, live, scheduled departures, soonest first: each
   * one's seats and its shop-local date.
   */
  upcomingDepartures?: readonly { capacity: number; on: string }[];
}): BoatSeatsRefusal | null {
  const limit = input.certifiedPassengers;
  const totalPersons = input.certifiedTotalPersons ?? null;
  if (totalPersons !== null && input.capacity > totalPersons) {
    return { code: "seats_above_total_persons", capacity: input.capacity, limit: totalPersons };
  }
  if (limit === null) return null;
  if (totalPersons !== null && limit > totalPersons) {
    return { code: "passengers_above_total_persons", passengers: limit, limit: totalPersons };
  }
  if (passengersAboveCertificate(input.capacity, limit)) {
    return { code: "seats_above_certificate", capacity: input.capacity, limit };
  }
  const over = (input.upcomingDepartures ?? []).filter((departure) =>
    passengersAboveCertificate(departure.capacity, limit),
  );
  return over.length > 0
    ? {
        code: "departures_above_certificate",
        departures: over.length,
        limit,
        firstDates: over.slice(0, NAMED_DEPARTURES).map((departure) => departure.on),
      }
    : null;
}

/**
 * **The seats a departure may actually sell** (H-107): its own `capacity`,
 * never more than its boat's certificate allows. Both count everyone aboard
 * but crew, so they compare directly.
 *
 * This is the point-of-sale ceiling. The forms refuse a capacity above the
 * certificate, but a departure can still carry one — written before H-107,
 * copied, rolled from a series, reinstated, or moved onto a smaller hull — and
 * the booking transaction reads this under the trip-row lock so none of those
 * paths can sell seat certificate + 1. No boat, or no certificate recorded,
 * means the capacity alone binds.
 */
export function sellableSeats(
  capacity: number,
  certifiedPassengers: number | null | undefined,
): number {
  return certifiedPassengers == null ? capacity : Math.min(capacity, certifiedPassengers);
}

/**
 * A new departure's seats, lowered to its boat's certificate (H-107) — for the
 * paths that write a departure from another one rather than from a form: a
 * copy, and the nightly series roll. The source may predate H-107, or its
 * template may be cancelled or past and never re-saved; the new row starts
 * inside the limit instead of carrying the old number forward. A divers-only
 * limit comes down with it, so it never passes the boat's.
 */
export function seatsWithinCertificate(
  seats: { capacity: number; diverCapacity: number | null },
  certifiedPassengers: number | null | undefined,
): { capacity: number; diverCapacity: number | null } {
  const capacity = sellableSeats(seats.capacity, certifiedPassengers);
  const diverCapacity =
    seats.diverCapacity === null ? null : Math.min(seats.diverCapacity, capacity);
  return { capacity, diverCapacity };
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
  boat: BoatPaperDates & {
    certifiedPassengers: number | null;
    certifiedTotalPersons: number | null;
  };
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
  /**
   * The crew named on the departure, and how many of them the crew roll call
   * has recorded aboard at the departure checkpoint. Read only against total
   * persons (#2302): the passenger limit never counts crew.
   */
  crew: { assigned: number; boarded: number };
  onDate: CalendarDate;
  /** The shop's own date, when `onDate` is a later departure's (`boatPaperNotices`). */
  today?: CalendarDate;
}): BoatSafetyNotice[] {
  const notices: BoatSafetyNotice[] = [
    ...kitMissingNotices(input.kit, input.kindsOnRegister),
    ...boatPaperNotices(input.boat, input.onDate, input.today),
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
  const totalLimit = input.boat.certifiedTotalPersons;
  if (totalLimit !== null) {
    // The same switch as the passenger line, with the crew added on both
    // sides: who is named for the boat, then who is counted aboard once more
    // of them are than the certificate allows.
    const booked = input.passengers.booked + input.crew.assigned;
    const boarded = input.passengers.boarded + input.crew.boarded;
    if (boarded > totalLimit) {
      notices.push({
        code: "over_total_persons",
        persons: boarded,
        limit: totalLimit,
        counted: true,
      });
    } else if (booked > totalLimit) {
      notices.push({
        code: "over_total_persons",
        persons: booked,
        limit: totalLimit,
        counted: false,
      });
    }
  }
  return notices.sort(byUrgency);
}

/**
 * The papers whose lapse means the boat is not certified to carry anyone: the
 * certificate itself and its inspection (dive-domain review D3). Danger once
 * lapsed, and on Today for every role. Informs; nothing refuses on it.
 */
function isLapsedCertification(notice: BoatSafetyNotice): boolean {
  return (
    notice.code === "paper" &&
    notice.expired &&
    (notice.paper === "coi" || notice.paper === "inspection")
  );
}

/**
 * The notices Today raises **on a departure sailing today** (danger, every
 * role): a must-carry kind missing, any clock on oxygen, the AED or flares
 * aboard that has run out or will inside the kit horizon, and a lapsed
 * certificate or inspection.
 */
export function lifeSafetyNotices(notices: readonly BoatSafetyNotice[]): BoatSafetyNotice[] {
  return notices.filter(
    (notice) =>
      notice.code === "kit_missing" ||
      (notice.code === "kit_clock" && isLifeSafetyKitKind(notice.kind)) ||
      isLapsedCertification(notice),
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
 * How loudly a notice is drawn. **Danger** for what means the boat is not as
 * it should be to leave: must-carry kit missing, more passengers or more
 * persons than the certificate allows, and a lapsed paper — the certificate,
 * hull insurance, registration or the safety inspection past its date, the fact that makes a claim uncovered
 * (H-136). **Warning** for kit that has gone wrong (a lapsed clock, a unit
 * flagged for service). **Neutral** for a heads-up.
 *
 * Tone only: a danger line here refuses nothing. The certificate's own gate
 * lives at the point of sale (`sellableSeats`), and a lapsed paper has none —
 * DiveDay cannot know a policy was renewed offline.
 */
export function boatSafetyNoticeTone(notice: BoatSafetyNotice): BoatSafetyTone {
  if (
    notice.code === "over_certificate" ||
    notice.code === "over_total_persons" ||
    notice.code === "kit_missing" ||
    isLapsedCertification(notice)
  ) {
    return "danger";
  }
  if (notice.code === "kit_off_service") return "warning";
  if (notice.code === "paper") return notice.expired ? "danger" : "neutral";
  return notice.expired ? "warning" : "neutral";
}

/** Whether a notice is something that has already gone wrong rather than a heads-up. */
export function boatSafetyNoticeIsUrgent(notice: BoatSafetyNotice): boolean {
  return boatSafetyNoticeTone(notice) !== "neutral";
}

function rank(notice: BoatSafetyNotice): number {
  if (notice.code === "kit_missing") return 0;
  if (notice.code === "over_certificate" || notice.code === "over_total_persons") return 1;
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
