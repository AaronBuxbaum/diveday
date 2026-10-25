// i18n-exempt-file: test fixture; only the ScheduleBuilder tests import it, and its words stand in for the bundle's.
import { cleanup } from "@testing-library/react";
import { vi } from "vitest";
import type { MovePreflight } from "@/lib/move-preflight";
import type { BuilderCopy, BuilderMoreOptions, BuilderPriceInput } from "./ScheduleBuilder";
import type { BuilderWeek } from "./WeekBoard";

/**
 * **The schedule builder's fixtures**, shared by its four test files (the add panel, the
 * create form, the week board and the move preview), which were one 2,626-line file.
 */

// The board route has no dynamic id, so `usePathname()` is what
// ScheduleBuilder keys its disarm-on-revisit effect on (see the component's
// own doc comment). `setMockPathname` simulates a navigation event —
// including an Activity-preserved show/hide cycle, should
// `cacheComponents: true` be re-enabled — without a real Next.js router.
// Each test file hands these to `vi.mock("next/navigation", …)`.
let currentPath = "/shop/blue-mantis/schedule/board";
export const routerReplace = vi.fn();
export const usePathname = vi.fn(() => currentPath);
export function setMockPathname(next: string) {
  currentPath = next;
}
// The top add panel's Cancel clears the `?add` that opened it via
// router.replace; the tests only need the calls to exist, not a router.
export const useRouter = vi.fn(() => ({ replace: routerReplace }));
export const useSearchParams = vi.fn(() => new URLSearchParams());

export const COPY: BuilderCopy = {
  typedAs: "typed as “{raw}”",
  draftPickedUp: "Picked up from the desk, {time}.",
  draftStartOver: "Start over",
  patternFilled: "Filled from your last {count} {weekday} departures. Change anything, or",
  patternStartBlank: "start blank",
  patternCrew: "{names} crewed them.",
  patternAlsoUsual: "{time} · {title} ran on {count} of those days too.",
  patternAlsoUsualUntitled: "{time} · another departure ran on {count} of those days too.",
  patternAddAlso: "Add it as well",
  ariaLabel: "Schedule builder",
  addDepartureOnDay: "Add a departure on {day}",
  add: "Add",
  cancel: "Cancel",
  noSiteSetYet: "No site set yet",
  courseLabel: "Course · {title}",
  dayCountLabelOne: "{count} day",
  dayCountLabelOther: "{count} days",
  impactTitle: "If you move it",
  impactBoatClash: "{boat} is already out on {departure} at that time.",
  impactCrewClash: "{name} is already rostered on {departure} at that time.",
  impactCrewAway: "{name} has told you they are away then.",
  impactTurnaroundBoat: "Tight turnaround: {boat} has {minutes} min between this and {departure}.",
  impactTurnaroundCrew:
    "Tight turnaround: {name} has {minutes} min between this and {departure}, from another meeting point.",
  impactToldOne: "{count} diver has already been told this date. Moving it tells them the new one.",
  impactToldOther:
    "{count} divers have already been told this date. Moving it tells them the new one.",
  impactGearOne: "{count} reserved unit travels with it.",
  impactGearOther: "{count} reserved units travel with it.",
  impactPaidOne: "{count} seat is already paid.",
  impactPaidOther: "{count} seats are already paid.",
  impactWindowOne: "Cancellations close {count} hour before it departs.",
  impactWindowOther: "Cancellations close {count} hours before it departs.",
  impactBlockedSailed: "The crew has already counted heads against this departure.",
  impactBlockedNotScheduled: "A canceled trip can’t be moved.",
  crewLabel: "Crew:",
  crewNobodyYet: "nobody yet",
  windLabel: "Wind:",
  noPriceSet: "No price set",
  noPriceSetAria: "Set a price for {ref}",
  noPriceSetAll:
    "None of these departures has a price yet, and divers already see them on the schedule. Open a departure to set one.",
  rehearsal: "Rehearsal",
  noBoats: "No boats",
  quietDays: "{first} to {last}",
  asked: "Asked for",
  addDeparture: "Add a departure",
  rollCallOpen: "Roll call · {count} not counted",
  rollCallOpenAria: "Finish the dive {dive} roll call for {ref}",
  rollCallOpenNote: "Back at the dock with the dive {dive} roll call still open.",
  rowActionsAria: "Move, copy, or remove {ref}",
  move: "Move",
  moveAria: "Move {ref}",
  copy: "Copy",
  copyAria: "Copy {ref}",
  remove: "Remove",
  removeAria: "Remove {ref}",
  removeConfirm: "Take “{title}” off the board for good?",
  removeConfirmButton: "Yes, remove the trip",
  removeCancel: "Never mind",
  removePending: "…",
  whatIsIt: "What is it",
  titlePlaceholder: "Two-Tank Reef",
  date: "Date",
  departs: "Departs",
  returns: "Returns",
  seats: "Seats",
  dives: "Dives",
  price: "Price per diver",
  priceDescription: "Divers see this on the public page.",
  course: "Course",
  optional: "(optional)",
  courseAgencyLabels: { padi: "PADI", ssi: "SSI", other: "Other agency" },
  diveSite: "Dive site",
  ordinaryTrip: "Fun dive",
  decideLater: "Decide later",
  adding: "Adding…",
  putOnBoard: "Put it on the board",
  newDate: "New date",
  multiDayNote: "All {count} days move together, keeping their gaps.",
  newDepartureTime: "New departure time",
  moving: "Moving…",
  moveIt: "Move it",
  copyTo: "Copy to",
  copyDescription: "Same dive, same seats, same price, with no divers.",
  copySameCrew: "Same crew",
  departureTime: "Departure time",
  copying: "Copying…",
  copyIt: "Copy it",
  viewOnlyNotice: "Scheduling and editing trips is limited to owners, managers, and instructors.",
  moreOptions: "More options",
  fewerOptions: "Fewer options",
  moreOptionsDescription: "Description, multi-day, deposit, cancellation window, repeat.",
  titlePlaceholderCourse: "{courseTitle} — Session 1",
  courseNote: "{requirement} · add an instructor before sharing the session",
  courseCertRequired: "{level} card required at enrollment",
  courseNoCardRequired: "No existing C-card required",
  descriptionLabel: "Description",
  descriptionPlaceholder: "Sites, conditions, who it’s for.",
  isPrivateLabel: "Private charter",
  selfGuidedLabel: "Self-guided dive",
  selfGuidedHint: "Buddy pairs go in without a guide.",
  isPrivateHint:
    "Off the public schedule. Anyone with the link can see the departure and book a seat.",
  isRehearsalLabel: "Rehearsal for training day",
  isRehearsalHint: "Practice only.",
  daysLabel: "How many days",
  daysDescription: "Most departures are one day.",
  meetingDayLabel: "Day {number}",
  payAtBookingLegend: "Pay at booking",
  payAtBookingDescription: "Optional.",
  depositLabel: "Deposit per diver",
  depositDescription: "Charged now.",
  depositTitle: "Only applies when set below the trip price.",
  cancellationWindowLabel: "Free cancellation until",
  cancellationWindowDescription: "Hours before departure.",
  minimumBookingsLabel: "Minimum to run",
  minimumBookingsDescription: "Blank means the boat goes with whoever books.",
  minimumDecisionLabel: "Decide by",
  minimumDecisionDescription: "How long before departure the call is made.",
  diversSuffix: "divers",
  hoursBeforeSuffix: "hours before",
  repeatLegend: "Repeat",
  howOftenLabel: "How often",
  doesntRepeat: "Doesn’t repeat",
  everyWeek: "Every week",
  every2Weeks: "Every 2 weeks",
  every4Weeks: "Every 4 weeks",
  repeatsOnLabel: "Repeats on",
  everyDay: "Every day",
  endsLabel: "Ends",
  endsNever: "Keeps repeating",
  endsOnChoice: "On a date",
  endsOnLabel: "Last date",
  diveModeLabel: "Dive mode",
  modeBoat: "Boat dive",
  modeShore: "Shore dive",
  modePool: "Pool session",
  boatSelectLabel: "Assigned boat",
  unassignedBoat: "Any / unassigned",
  lensLabel: "Trip tag",
  lensNone: "None",
};

/** The bounds and shared dive-card words the expanded half of the panel needs. */
export const MORE: BuilderMoreOptions = {
  weekdayNames: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  minDays: 1,
  maxDays: 7,
  diveFields: {
    heading: "The dive plan",
    description: "A {tripShape}.",
    twoTankTrip: "two-tank trip",
    diveCountTripOne: "{count}-dive trip",
    diveCountTripOther: "{count}-dive trip",
    numberOfDivesLabel: "Number of dives",
    diveOptionOne: "{count} dive",
    diveOptionOther: "{count} dives",
    diveLegend: "Dive {number}",
    nameLabel: "Name",
    optionalHint: "(optional)",
    namePlaceholderFirst: "Morning reef",
    namePlaceholderOther: "Second tank",
    diveSiteLabel: "Dive site",
    noSiteChosen: "Decide later",
    travelLabelFirst: "Minutes out from the dock",
    travelLabelOther: "Minutes from the previous site",
    travelHint: "(blank uses your usual ride out)",
    diverFacingDetailsLabel: "Diver-facing details",
    footerNote: "Divers see this on the booking page.",
  },
};

/** One departure as a spec writes it — the fields these fixtures have always set. */
export type FixtureTrip = {
  id: string;
  title: string;
  dateIso: string;
  startTime: string;
  timeRange: string;
  capacity: number;
  booked: number;
  courseTitle: string | null;
  diveSiteName: string | null;
  dayCount: number;
  crew: string[];
  priceCents: number | null;
  rollCallOpen: { diveNumber: number; uncounted: number } | null;
};

export function baseTrip(overrides: Partial<FixtureTrip> = {}): FixtureTrip {
  return {
    id: "trip-1",
    title: "Two-Tank Reef",
    dateIso: "2026-08-01",
    startTime: "08:30",
    timeRange: "8:30 AM – 12:30 PM",
    capacity: 12,
    booked: 3,
    courseTitle: null,
    diveSiteName: "Molasses Reef",
    dayCount: 1,
    crew: ["Dana Reyes"],
    priceCents: 8500,
    rollCallOpen: null,
    ...overrides,
  };
}

/**
 * A day of fixture departures, in the shape these specs have always written
 * them. It was `BuilderDay` until the board lost its second composition
 * (#1923); the type went with the stream and the fixtures stayed, because
 * what a spec wants to say is still "on this day, these boats".
 */
export type FixtureDay = {
  dateIso: string;
  label: string;
  parts: { weekday: string; day: string; month: string };
  trips: FixtureTrip[];
  boatWarning?: string | null;
};

/**
 * **The one board, built from a spec's own days.**
 *
 * Every flow below used to drive the vertical day stream, because the fleet
 * ran one pixel under `xl` and that is what rendered there. The stream is gone
 * and the week renders at every width, so the fixtures are converted rather
 * than rewritten: a spec still says "a Saturday with these two boats" and gets
 * the composition the product actually has.
 *
 * The day's `label` carries through untouched — it is what names the per-day
 * "Add a departure on …" button, in the week exactly as in the stream, which
 * is why most of these specs needed nothing but this.
 */
export function weekFrom(days: FixtureDay[], overrides: Partial<BuilderWeek> = {}): BuilderWeek {
  const first = days[0]?.dateIso ?? "2026-08-01";
  return {
    ariaLabel: "The week",
    rangeLabel: "The week",
    previousHref: `/shop/blue-mantis/schedule/board?week=${first}`,
    nextHref: `/shop/blue-mantis/schedule/board?week=${first}`,
    thisWeekHref: null,
    allUnpriced: false,
    nextDeparture: null,
    seatTally: "",
    asked: [],
    askedCount: "0 days",
    words: {
      previous: "Previous week",
      next: "Next week",
      thisWeek: "This week",
      today: "Today",
    },
    days: days.map((day) => ({
      dateIso: day.dateIso,
      weekday: day.parts.weekday,
      dayNumber: day.parts.day,
      label: day.label,
      isToday: false,
      isPast: false,
      boatWarning: day.boatWarning ?? null,
      entries: day.trips.map((trip) => ({
        tripId: trip.id,
        dateIso: day.dateIso,
        startTime: trip.startTime,
        title: trip.title,
        time: trip.timeRange.split(" – ")[0] ?? trip.timeRange,
        meta: trip.diveSiteName ?? "",
        seats: { booked: trip.booked, capacity: trip.capacity },
        seatsLabel: `${trip.booked} of ${trip.capacity}`,
        crew: trip.crew,
        dayCount: trip.dayCount,
        status: "upcoming" as const,
        unpriced: trip.priceCents === null,
        rehearsal: false,
        rollCallOpen: trip.rollCallOpen,
        ref: `${trip.title}, ${day.label} ${trip.timeRange}`,
      })),
    })),
    spans: [],
    ...overrides,
  };
}

export const noop = vi.fn();
export const actions = {
  add: noop,
  move: noop,
  duplicate: noop,
  remove: noop,
  draft: { save: async () => {}, discard: async () => {} },
};

/** Already resolved server-side from the shop's currency and the reader's locale. */
export const PRICE: BuilderPriceInput = { step: "0.01", max: 100_000, placeholder: "$0.00" };

/**
 * The board no longer ships the catalogue with every render: the add panel
 * asks for its two option lists when it opens. Every test here gets the same
 * stub, and the one that cares asserts it is not called until then.
 */
export const loadOptions = vi.fn(async () => ({
  courses: [{ id: "course-1", title: "Open Water Diver", agency: "padi" }],
  diveSites: [{ id: "site-1", title: "Molasses Reef" }],
}));

/**
 * The move panel's impact preview (issue #1203). Quiet by default — most tests
 * here are about other panels entirely, and a departure with no consequences
 * renders no block, which is the shape the component must stay correct in.
 */
export const loadMovePreflight = vi.fn(
  async (
    _tripId: string,
    _target: { date: string; startTime: string } | null,
  ): Promise<MovePreflight | null> => ({ blocked: null, sections: [] }),
);

/** What every test file's `afterEach` puts back. */
export function resetScheduleBuilderFixtures() {
  cleanup();
  loadOptions.mockClear();
  loadMovePreflight.mockClear();
  loadMovePreflight.mockImplementation(async () => ({ blocked: null, sections: [] }));
  routerReplace.mockClear();
  useSearchParams.mockReturnValue(new URLSearchParams());
  setMockPathname("/shop/blue-mantis/schedule/board");
}
