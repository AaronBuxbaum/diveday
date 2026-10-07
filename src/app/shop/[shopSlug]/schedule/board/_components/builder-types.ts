import type { FormDraftActions } from "@/components/FormDraft";
import type { TripDiveFieldsCopy } from "@/components/TripDiveFields";

/**
 * **The schedule builder's shapes** — what the board page hands
 * `ScheduleBuilder`, and what its add panel (`AddPanel`) reads. Types only, so
 * the server page and the server actions import them without the client code.
 */
export type BuilderOption = { id: string; title: string };

/** What the add panel sends to ask about the tide at a chosen site. */
export type BuilderTideWindowInput = {
  diveSiteId: string;
  /** `YYYY-MM-DD`, the shop's own calendar. */
  date: string;
  /** `HH:MM` as the forgiving time box canonicalised it; anything else answers null. */
  startTime: string;
  diveMode: string;
};
export type BuilderCourseOption = BuilderOption & { agency: string };
export type BuilderBoatOption = { id: string; name: string; capacity: number };

/**
 * What the add-a-departure panel's two selects offer. Fetched when the panel
 * opens (`loadOptions` below) rather than serialized into this component's
 * props on every board render: a shop's whole course catalogue and every dive
 * site it dives, shipped to a browser for two controls behind a closed panel.
 */
/** The three kinds of departure a shop can run, in the order the select offers them. */
export type DiveMode = "boat" | "shore" | "pool";

export type BuilderOptions = {
  courses: BuilderCourseOption[];
  diveSites: BuilderOption[];
  boats?: BuilderBoatOption[];
  /** The shop's trip tags (ADR 20260904-reef-all-the-way-down). */
  lenses?: BuilderOption[];
  hasBoatDiving?: boolean;
  hasShoreDiving?: boolean;
  hasPoolDiving?: boolean;
};

/**
 * Everything the price box needs that is neither copy nor a value — all of it
 * derived server-side from the shop's currency and the reader's locale, since
 * a Client Component may format neither.
 */
export type BuilderPriceInput = {
  /** `step`, from the currency's fraction digits: "1" for a zero-decimal one. */
  step: string;
  /** The largest figure the box accepts, in the shop's major units. */
  max: number;
  /** Zero, formatted for the shop's currency — the box's placeholder. */
  placeholder: string;
};

export type BuilderActions = {
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  add: (formData: FormData) => void | Promise<void>;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  move: (formData: FormData) => void | Promise<void>;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  duplicate: (formData: FormData) => void | Promise<void>;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  remove: (formData: FormData) => void | Promise<void>;
  /** The add panel's draft, kept and discarded (ADR 20260906-before-you-ask, decision 3). */
  draft: FormDraftActions;
};

/**
 * Every word the builder shows, resolved server-side from the staff bundle
 * (`staffTranslator`, since this is a Client Component and cannot translate
 * itself). Values that vary per day or per trip stay as `{placeholder}`
 * templates and are filled in at render time with `fill` below — the
 * template text itself is still a fully-translated, complete sentence, never
 * a prefix/suffix pair assembled from parts.
 */
export type BuilderCopy = {
  /** "typed as “{raw}”" — the forgiving time fields' reading line. */
  typedAs: string;
  /** The add panel's draft line (ADR 20260906-before-you-ask, decision 3). */
  draftPickedUp: string;
  draftStartOver: string;
  /** The add panel's weekday-pattern lines (same decision). */
  patternFilled: string;
  patternStartBlank: string;
  patternCrew: string;
  patternAlsoUsual: string;
  patternAlsoUsualUntitled: string;
  patternAddAlso: string;
  ariaLabel: string;
  addDepartureOnDay: string;
  add: string;
  cancel: string;
  noSiteSetYet: string;
  courseLabel: string;
  dayCountLabelOne: string;
  dayCountLabelOther: string;
  crewLabel: string;
  crewNobodyYet: string;
  windLabel: string;
  noPriceSet: string;
  noPriceSetAria: string;
  noPriceSetAll: string;
  /** What a week's day with nothing on it says (slice 23f). */
  noBoats: string;
  /** The heading over the days somebody asked for (slice 23f). */
  asked: string;
  /** The act that answers one — the Requests page's own word for it. */
  addDeparture: string;
  rollCallOpen: string;
  rollCallOpenAria: string;
  rollCallOpenNote: string;
  rowActionsAria: string;
  move: string;
  moveAria: string;
  copy: string;
  copyAria: string;
  remove: string;
  removeAria: string;
  removeConfirm: string;
  removeConfirmButton: string;
  removeCancel: string;
  removePending: string;
  whatIsIt: string;
  titlePlaceholder: string;
  date: string;
  departs: string;
  returns: string;
  seats: string;
  dives: string;
  price: string;
  priceDescription: string;
  course: string;
  optional: string;
  courseAgencyLabels: { padi: string; ssi: string; other: string };
  diveSite: string;
  ordinaryTrip: string;
  decideLater: string;
  optionsLoading: string;
  adding: string;
  putOnBoard: string;
  newDate: string;
  multiDayNote: string;
  newDepartureTime: string;
  moving: string;
  moveIt: string;
  /* ---- the move panel's impact preview (issue #1203, D43) ---- */
  impactTitle: string;
  /**
   * Named, one line per person — never a count (issue #1310). The clash takes
   * `{name}` and `{departure}`; the blackout takes `{name}`. Neither needs a
   * plural pair, because each renders once per person.
   */
  impactCrewClash: string;
  impactCrewAway: string;
  /**
   * The hull already out on another departure at those hours (H-80: one hull,
   * one departure at a time). Takes `{boat}` and `{departure}`; one line per
   * other departure, so no plural pair.
   */
  impactBoatClash: string;
  impactToldOne: string;
  impactToldOther: string;
  impactGearOne: string;
  impactGearOther: string;
  impactPaidOne: string;
  impactPaidOther: string;
  impactWindowOne: string;
  impactWindowOther: string;
  /** The two refusals `moveTrip` gives, in the notice bar's own words. */
  impactBlockedSailed: string;
  impactBlockedNotScheduled: string;
  copyTo: string;
  copyDescription: string;
  departureTime: string;
  copying: string;
  copyIt: string;
  /* ---- the "More options" half of the one trip form (ADR 20260806-one-trip-create-form) ---- */
  viewOnlyNotice: string;
  moreOptions: string;
  fewerOptions: string;
  moreOptionsDescription: string;
  titlePlaceholderCourse: string;
  courseNote: string;
  courseCertRequired: string;
  courseNoCardRequired: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  isPrivateLabel: string;
  isPrivateHint: string;
  selfGuidedLabel: string;
  selfGuidedHint: string;
  daysLabel: string;
  daysDescription: string;
  payAtBookingLegend: string;
  payAtBookingDescription: string;
  depositLabel: string;
  depositDescription: string;
  depositTitle: string;
  cancellationWindowLabel: string;
  cancellationWindowDescription: string;
  minimumBookingsLabel: string;
  minimumBookingsDescription: string;
  minimumDecisionLabel: string;
  minimumDecisionDescription: string;
  diversSuffix: string;
  hoursBeforeSuffix: string;
  hoursSuffix: string;
  repeatLegend: string;
  howOftenLabel: string;
  doesntRepeat: string;
  everyWeek: string;
  every2Weeks: string;
  every4Weeks: string;
  repeatsOnLabel: string;
  everyDay: string;
  endsLabel: string;
  endsNever: string;
  endsOnChoice: string;
  endsOnLabel: string;
  requestPlanHeading?: string;
  requestPlanDescription?: string;
  requestPlanRecommendation?: string;
  requestPlanRecommendationDiversOne?: string;
  requestPlanRecommendationDiversOther?: string;
  requestPlanRecommendationCapacityOne?: string;
  requestPlanRecommendationCapacityOther?: string;
  requestPlanDiversOne?: string;
  requestPlanDiversOther?: string;
  requestPlanPersonOne?: string;
  requestPlanPersonOther?: string;
  requestPlanBoatRecommendationOne?: string;
  requestPlanBoatRecommendationOther?: string;
  requestPlanBoatExceeded?: string;
  requestPlanCrewSuggestionOne?: string;
  requestPlanCrewSuggestionOther?: string;
  diveModeLabel?: string;
  modeBoat?: string;
  modeShore?: string;
  modePool?: string;
  boatSelectLabel?: string;
  unassignedBoat?: string;
  lensLabel?: string;
  lensNone?: string;
};

/**
 * A course the panel opens already pointed at, handed over by the staff course
 * catalogue's "schedule a session" control (`?course=<id>` on the board). Its
 * title is carried with the id because the select's options arrive on their own
 * fetch — without it the preselected course would render as a blank row until
 * the catalogue landed.
 */
export type BuilderInitialCourse = {
  id: string;
  title: string;
  /** The admission line the old full form showed under the select, pre-resolved. */
  requirement: string;
};

export type BuilderInitialSite = {
  id: string;
  name: string;
};

/**
 * Lead context handed from Requests to the one trip-creation form. Checked
 * rows become invitations only; they do not become bookings or consume seats.
 */
export type BuilderRequestPlan = {
  estimatedDivers: number;
  suggestedCapacity: number;
  /** Divemasters these leads want at the shop's target, and the target itself. */
  suggestedDivemasters: number;
  diversPerDivemaster: number;
  suggestedBoatName?: string | null;
  exceedsKnownBoats?: boolean;
  requests: Array<{
    id: string;
    name: string;
    subject: string;
    divers: number;
  }>;
};

/**
 * What the shop ran on this weekday over the last six weeks, shaped for the
 * add panel's own controls (ADR 20260906-before-you-ask, decision 3). Read by
 * `loadWeekdayPatternAction` when a panel opens on a day with no draft.
 */
export type BuilderPattern = {
  /** 0 = Sunday, as `BuilderMoreOptions.weekdayNames` is indexed. */
  weekday: number;
  sampledDays: number;
  /** Field name → the string its control would hold; a field the days disagreed on is absent. */
  fields: Record<string, string>;
  /** The people aboard on most of those days, most frequent first. */
  crew: Array<{ id: string; name: string }>;
  /** A second departure most of those days also carried, offered as one row. */
  alsoUsual: { startTime: string; timeLabel: string; title: string | null; days: number } | null;
};

/** Everything the panel needs that only matters once "More options" is open. */
export type BuilderMoreOptions = {
  /**
   * The seven weekday names, Sunday first, spelled for the request locale — the
   * repeat fieldset's day picker. Calendar data, so `Intl` provides them rather
   * than the message bundle; they are resolved on the server because that is
   * where the negotiated locale lives.
   */
  weekdayNames: string[];
  /** Meeting-day bounds for a multi-day departure (src/lib/trip-days.ts). */
  minDays: number;
  maxDays: number;
  /** The per-dive cards' own words, shared with the trip editor. */
  diveFields: TripDiveFieldsCopy;
};
