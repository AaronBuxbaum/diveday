/**
 * **The boat as a machine with papers and an emergency kit** (roadmap N-08 and
 * the paper half of N-10): what a departure's pre-departure check says about
 * the hull it sails on.
 *
 * Three kinds of fact, all informing and none gating — the dock decides, not
 * the software, the same posture as the gear register's service clocks
 * (ADR 20260815-minimal-gear-register) and the pre-departure checklist (ADR
 * 20260824-pre-departure-safety-check):
 *
 * - **Too many people for the certificate.** A boat's Coast Guard Certificate
 *   of Inspection names a passenger limit; when the people booked aboard pass
 *   it, the manifest says so. The one capacity *block* stays where it was
 *   (`tripDetailsPatch`: a departure may not sell more seats than the boat's
 *   own `capacity`).
 * - **The boat's papers**: inspection due, registration and insurance expiry.
 * - **The safety kit aboard**: O2 kit, AED, first-aid kit and flares are gear
 *   register units (`gear_items`, opt-in by presence) that may be assigned to
 *   one hull, each running its own printed-date clocks.
 *
 * Pure and framework-free: codes and numbers out, never sentences
 * (`src/i18n/boat-safety-labels.ts` words them).
 */

import { type CalendarDate, calendarDaysBetween } from "./calendar-date";
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
 * How far ahead the check looks: the register's own "due soon" window, so a
 * unit that reads due on the gear page reads due on the boat too.
 */
export const BOAT_SAFETY_HORIZON_DAYS = GEAR_SERVICE_DUE_SOON_DAYS;

/** The boat's three paper clocks. */
export const BOAT_PAPERS = ["inspection", "registration", "insurance"] as const;
export type BoatPaper = (typeof BOAT_PAPERS)[number];

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
  | { code: "over_certificate"; aboard: number; limit: number }
  | { code: "paper"; paper: BoatPaper; dueOn: CalendarDate; expired: boolean; days: number }
  | {
      code: "kit_clock";
      gearItemId: string;
      label: string;
      clock: GearServiceKind;
      dueOn: CalendarDate;
      expired: boolean;
      days: number;
    }
  | { code: "kit_off_service"; gearItemId: string; label: string };

/**
 * A dated clock's reading against today, or null when it is past the horizon.
 * The printed date is the last good day: on it the pads are still in date, and
 * the day after they are not — the same boundary `gearServiceState` draws.
 */
function dated(dueOn: CalendarDate, todayLocal: CalendarDate) {
  const days = calendarDaysBetween(todayLocal, dueOn);
  if (days < 0) return { expired: true, days: -days };
  if (days <= BOAT_SAFETY_HORIZON_DAYS) return { expired: false, days };
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
  todayLocal: CalendarDate,
): BoatSafetyNotice[] {
  const notices: BoatSafetyNotice[] = [];
  for (const unit of units) {
    if (unit.status !== "in_service") {
      notices.push({ code: "kit_off_service", gearItemId: unit.id, label: unit.label });
    }
    for (const clock of unit.clocks) {
      if (!clock.nextDueOn) continue;
      const reading = dated(clock.nextDueOn, todayLocal);
      if (!reading) continue;
      notices.push({
        code: "kit_clock",
        gearItemId: unit.id,
        label: unit.label,
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

/** The boat's papers that have run out or will inside the horizon. */
export function boatPaperNotices(
  papers: BoatPaperDates,
  todayLocal: CalendarDate,
): BoatSafetyNotice[] {
  const notices: BoatSafetyNotice[] = [];
  for (const paper of BOAT_PAPERS) {
    const dueOn = papers[PAPER_DATES[paper]];
    if (!dueOn) continue;
    const reading = dated(dueOn, todayLocal);
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
 * Everything the pre-departure check says about this departure's boat, most
 * urgent first: too many people aboard, then what has already run out (the
 * longest-expired leading), then kit off for service, then what is about to
 * run out (the soonest leading).
 */
export function boatSafetyNotices(input: {
  boat: BoatPaperDates & { certifiedPassengers: number | null };
  kit: readonly SafetyKitUnit[];
  /** The people booked aboard (divers and non-divers alike), crew excluded. */
  passengersAboard: number;
  todayLocal: CalendarDate;
}): BoatSafetyNotice[] {
  const notices: BoatSafetyNotice[] = [
    ...boatPaperNotices(input.boat, input.todayLocal),
    ...safetyKitNotices(input.kit, input.todayLocal),
  ];
  if (passengersAboveCertificate(input.passengersAboard, input.boat.certifiedPassengers)) {
    notices.push({
      code: "over_certificate",
      aboard: input.passengersAboard,
      limit: input.boat.certifiedPassengers ?? 0,
    });
  }
  return notices.sort(byUrgency);
}

/**
 * Only what has already run out — Today's owner row. The certificate is left
 * out on purpose: it is one departure's fact and its manifest says it.
 */
export function expiredBoatSafetyNotices(notices: readonly BoatSafetyNotice[]): BoatSafetyNotice[] {
  return notices.filter(
    (notice) => (notice.code === "paper" || notice.code === "kit_clock") && notice.expired,
  );
}

/**
 * Whether a notice is something that has already gone wrong (warning ink)
 * rather than a heads-up: too many aboard, a lapsed date, kit off the boat.
 */
export function boatSafetyNoticeIsUrgent(notice: BoatSafetyNotice): boolean {
  if (notice.code === "over_certificate" || notice.code === "kit_off_service") return true;
  return notice.expired;
}

function rank(notice: BoatSafetyNotice): number {
  if (notice.code === "over_certificate") return 0;
  if (notice.code === "kit_off_service") return 2;
  return notice.expired ? 1 : 3;
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
