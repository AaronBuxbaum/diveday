// i18n-exempt-file: test fixture; only the day spine's tests import it, and its words are seeded data.
import { render } from "@testing-library/react";
import type { FirstBooking } from "@/db/first-booking";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { assembleEveningClose, type CloseoutDeparture, type DayLoadOut } from "@/lib/closeout";
import {
  assembleDaySpine,
  type FactOfScale,
  type SpineDeparture,
  type TodayAction,
} from "@/lib/today";
import { DaySpine, type EveningReading, type SpineDraft } from "./DaySpine";

/**
 * **The day spine's fixtures**, shared by its four test files (stations, moments, rows and the
 * evening reading), which were one 2,104-line file. A test file that imports these mocks the
 * spine's server actions itself: `vi.mock` holds for the file that calls it.
 */

export const NOW = new Date("2026-08-27T11:00:00Z");
export const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

export function action(overrides: Partial<TodayAction> = {}): TodayAction {
  return {
    id: "a",
    kind: "waiver",
    urgency: "now",
    subject: "Diver",
    context: null,
    detail: "…",
    actionLabel: "Open roster",
    href: "/shop/blue-mantis/trips/t1",
    dueAt: null,
    ...overrides,
  };
}

export function departure(overrides: Partial<SpineDeparture> = {}): SpineDeparture {
  return {
    tripId: "t1",
    title: "Two-Tank Reef",
    startsAt: hoursFromNow(2),
    endsAt: hoursFromNow(5),
    siteName: "Molasses Reef",
    courseTitle: null,
    boatName: "Mantis II",
    priceCents: 9500,
    capacity: 12,
    booked: 10,
    boarded: 0,
    blocked: 0,
    crew: [{ fullName: "Keiko Tanaka" }],
    crewAccountedFor: true,
    crewReason: null,
    rehearsal: false,
    ...overrides,
    sellableCapacity: overrides.sellableCapacity ?? overrides.capacity ?? 12,
  };
}

export const boat = (tripId: string, label = "Two-Tank Reef · 7:00 AM") => ({ tripId, label });

/**
 * One of the day's departures as the closing state sees it — the shape
 * `assembleDayCloseout` hands `assembleEveningClose`. Built here rather than
 * run through the whole assembly so an evening case can state the one fact it
 * is about.
 */
export function closed(
  overrides: Partial<CloseoutDeparture> & { tripId: string },
): CloseoutDeparture {
  const booked = overrides.booked ?? 10;
  return {
    title: "Two-Tank Reef",
    startsAt: hoursFromNow(-6),
    endsAt: hoursFromNow(-3),
    booked,
    // Nobody was marked absent, so the boat carried its whole roster — a case
    // about a no-show sets `sailed` lower (issue #1689).
    sailed: booked,
    capacity: 12,
    plannedDives: 2,
    // Two crew, both counted back at the closing checkpoint — the shape a
    // settled departure has once the day's counting is done (issue #1346).
    crew: [{ rollCall: { state: "boarded" } }, { rollCall: { state: "boarded" } }],
    planChanges: [],
    status: "all_home",
    gapReason: null,
    diveNumber: 0,
    uncounted: 0,
    recapShoutout: null,
    recapSentAt: null,
    recapAutoSendPaused: false,
    recapAutoSendAt: null,
    recapFailed: false,
    ended: true,
    photos: [],
    crewPhotos: [],
    ...overrides,
  };
}

export function evening(
  departures: CloseoutDeparture[],
  overrides: Partial<Omit<EveningReading, "close">> = {},
  tomorrow: DayLoadOut | null = null,
): EveningReading {
  return {
    close: assembleEveningClose(departures, NOW, tomorrow),
    takings: null,
    headCountCloses: new Map(),
    recapEditors: new Map(),
    canOpenLog: true,
    firstEver: false,
    ...overrides,
  };
}

export function renderSpine({
  departures = [departure()],
  actions = [],
  tomorrow = [],
  ...props
}: {
  departures?: SpineDeparture[];
  actions?: TodayAction[];
  tomorrow?: SpineDeparture[];
  showPaymentsRow?: boolean;
  drafts?: SpineDraft[];
  crewedTripIds?: string[];
  readerPersonId?: string;
  sessions?: React.ReactNode;
  firstRun?: React.ReactNode;
  firstBooking?: FirstBooking | null;
  factOfScale?: FactOfScale | null;
  crewTipsCents?: number;
  evening?: EveningReading;
  blocked?: number;
} = {}) {
  return render(
    <DaySpine
      context={{
        spine: assembleDaySpine({ departures, actions }, { departures: tomorrow, actions: [] }),
        shopSlug: "blue-mantis",
        shopName: "Blue Mantis",
        // The source locale: these tests read the English bundle.
        locale: DEFAULT_DIVER_LOCALE,
        timeZone: "America/New_York",
        currency: "usd",
        now: NOW,
        ...props,
      }}
    />,
  );
}

/** A crew's tap, at a fixed instant, for the stage-chip cases. */
export function stationStage(stage: "boarding" | "underway" | "surface" | "heading_in" | "home") {
  return {
    stage,
    siteName: "Molasses Reef",
    recordedAt: new Date("2026-07-21T11:20:00.000Z"),
    recordedByName: "Keiko Tanaka",
  };
}
