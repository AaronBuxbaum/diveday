// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, weekdayNames } from "@/lib/format";
import { currencyFractionDigits, maxPriceMajor, type ShopCurrency } from "@/lib/money";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS } from "@/lib/trip-days";
import type { BuilderCopy, BuilderMoreOptions, BuilderPriceInput } from "./ScheduleBuilder";
import { weekDayCopy } from "./week-copy";

/** Every word the departure builder says, resolved for the reader: a Client Component cannot translate itself. */
export function scheduleBuilderCopy(st: StaffTranslator): BuilderCopy {
  return {
    typedAs: st.raw("shared.forgiving.typedAs"),
    draftPickedUp: st.raw("shared.formDraft.pickedUp"),
    draftStartOver: st("shared.formDraft.startOver"),
    patternFilled: st.raw("schedule.builder.patternFilled"),
    patternStartBlank: st("schedule.builder.patternStartBlank"),
    patternCrew: st.raw("schedule.builder.patternCrew"),
    patternAlsoUsual: st.raw("schedule.builder.patternAlsoUsual"),
    patternAlsoUsualUntitled: st.raw("schedule.builder.patternAlsoUsualUntitled"),
    patternAddAlso: st("schedule.builder.patternAddAlso"),
    ariaLabel: st("schedule.builder.ariaLabel"),
    addDepartureOnDay: st.raw("schedule.builder.addDepartureOnDay"),
    add: st("schedule.builder.add"),
    cancel: st("schedule.builder.cancel"),
    noSiteSetYet: st("schedule.builder.noSiteSetYet"),
    courseLabel: st.raw("schedule.builder.courseLabel"),
    dayCountLabelOne: st.raw("schedule.builder.dayCountLabelOne"),
    dayCountLabelOther: st.raw("schedule.builder.dayCountLabelOther"),
    crewLabel: st("schedule.builder.crewLabel"),
    crewNobodyYet: st("schedule.builder.crewNobodyYet"),
    windLabel: st("schedule.builder.windLabel"),
    noPriceSet: st("schedule.builder.noPriceSet"),
    noPriceSetAria: st.raw("schedule.builder.noPriceSetAria"),
    noPriceSetAll: st("schedule.builder.noPriceSetAll"),
    rehearsal: st("trips.rehearsal.label"),
    ...weekDayCopy(st),
    addDeparture: st("requests.addDeparture"),
    rollCallOpen: st.raw("schedule.builder.rollCallOpen"),
    rollCallOpenAria: st.raw("schedule.builder.rollCallOpenAria"),
    rollCallOpenNote: st.raw("schedule.builder.rollCallOpenNote"),
    rowActionsAria: st.raw("schedule.builder.rowActionsAria"),
    move: st("schedule.builder.move"),
    moveAria: st.raw("schedule.builder.moveAria"),
    copy: st("schedule.builder.copy"),
    copyAria: st.raw("schedule.builder.copyAria"),
    remove: st("schedule.builder.remove"),
    removeAria: st.raw("schedule.builder.removeAria"),
    removeConfirm: st.raw("schedule.builder.removeConfirm"),
    removeConfirmButton: st("schedule.builder.removeConfirmButton"),
    removeCancel: st("schedule.builder.removeCancel"),
    removePending: st("schedule.builder.removePending"),
    whatIsIt: st("schedule.builder.whatIsIt"),
    titlePlaceholder: st("schedule.builder.titlePlaceholder"),
    date: st("schedule.builder.date"),
    departs: st("schedule.builder.departs"),
    returns: st("schedule.builder.returns"),
    seats: st("schedule.builder.seats"),
    dives: st("schedule.builder.dives"),
    price: st("schedule.builder.price"),
    priceDescription: st("schedule.builder.priceDescription"),
    course: st("schedule.builder.course"),
    optional: st("schedule.builder.optional"),
    courseAgencyLabels: {
      padi: st("schedule.builder.courseAgencies.padi"),
      ssi: st("schedule.builder.courseAgencies.ssi"),
      other: st("schedule.builder.courseAgencies.other"),
    },
    diveSite: st("schedule.builder.diveSite"),
    ordinaryTrip: st("schedule.builder.ordinaryTrip"),
    decideLater: st("schedule.builder.decideLater"),
    adding: st("schedule.builder.adding"),
    putOnBoard: st("schedule.builder.putOnBoard"),
    newDate: st("schedule.builder.newDate"),
    multiDayNote: st.raw("schedule.builder.multiDayNote"),
    newDepartureTime: st("schedule.builder.newDepartureTime"),
    moving: st("schedule.builder.moving"),
    moveIt: st("schedule.builder.moveIt"),
    impactTitle: st("schedule.builder.impactTitle"),
    impactBoatClash: st.raw("schedule.builder.impactBoatClash"),
    impactCrewClash: st.raw("schedule.builder.impactCrewClash"),
    impactCrewAway: st.raw("schedule.builder.impactCrewAway"),
    impactTurnaroundBoat: st.raw("schedule.builder.impactTurnaroundBoat"),
    impactTurnaroundCrew: st.raw("schedule.builder.impactTurnaroundCrew"),
    impactToldOne: st.raw("schedule.builder.impactToldOne"),
    impactToldOther: st.raw("schedule.builder.impactToldOther"),
    impactGearOne: st.raw("schedule.builder.impactGearOne"),
    impactGearOther: st.raw("schedule.builder.impactGearOther"),
    impactPaidOne: st.raw("schedule.builder.impactPaidOne"),
    impactPaidOther: st.raw("schedule.builder.impactPaidOther"),
    impactWindowOne: st.raw("schedule.builder.impactWindowOne"),
    impactWindowOther: st.raw("schedule.builder.impactWindowOther"),
    // The panel says up front exactly what the post-move notice would have said
    // afterwards — the same two keys `BUILDER_NOTICE_KEYS` maps, so a refusal
    // cannot be worded two ways depending on when you learn about it.
    impactBlockedSailed: st("schedule.notices.alreadySailed"),
    impactBlockedNotScheduled: st("schedule.notices.notScheduled"),
    copyTo: st("schedule.builder.copyTo"),
    copyDescription: st("schedule.builder.copyDescription"),
    copySameCrew: st("schedule.builder.copySameCrew"),
    departureTime: st("schedule.builder.departureTime"),
    copying: st("schedule.builder.copying"),
    copyIt: st("schedule.builder.copyIt"),
    viewOnlyNotice: st("schedule.builder.viewOnlyNotice"),
    moreOptions: st("schedule.builder.moreOptions"),
    fewerOptions: st("schedule.builder.fewerOptions"),
    moreOptionsDescription: st("schedule.builder.moreOptionsDescription"),
    titlePlaceholderCourse: st.raw("schedule.builder.titlePlaceholderCourse"),
    courseNote: st.raw("schedule.builder.courseNote"),
    courseCertRequired: st.raw("schedule.builder.courseCertRequired"),
    courseNoCardRequired: st("schedule.builder.courseNoCardRequired"),
    descriptionLabel: st("schedule.builder.descriptionLabel"),
    descriptionPlaceholder: st("schedule.builder.descriptionPlaceholder"),
    isPrivateLabel: st("schedule.builder.isPrivateLabel"),
    selfGuidedLabel: st("schedule.builder.selfGuidedLabel"),
    selfGuidedHint: st("schedule.builder.selfGuidedHint"),
    isPrivateHint: st("schedule.builder.isPrivateHint"),
    isRehearsalLabel: st("schedule.builder.isRehearsalLabel"),
    isRehearsalHint: st("schedule.builder.isRehearsalHint"),
    daysLabel: st("schedule.builder.daysLabel"),
    daysDescription: st("schedule.builder.daysDescription"),
    meetingDayLabel: st.raw("schedule.builder.meetingDayLabel"),
    payAtBookingLegend: st("schedule.builder.payAtBookingLegend"),
    payAtBookingDescription: st("schedule.builder.payAtBookingDescription"),
    depositLabel: st("schedule.builder.depositLabel"),
    depositDescription: st("schedule.builder.depositDescription"),
    depositTitle: st("schedule.builder.depositTitle"),
    cancellationWindowLabel: st("schedule.builder.cancellationWindowLabel"),
    cancellationWindowDescription: st("schedule.builder.cancellationWindowDescription"),
    minimumBookingsLabel: st("schedule.builder.minimumBookingsLabel"),
    minimumBookingsDescription: st("schedule.builder.minimumBookingsDescription"),
    minimumDecisionLabel: st("schedule.builder.minimumDecisionLabel"),
    minimumDecisionDescription: st("schedule.builder.minimumDecisionDescription"),
    diversSuffix: st("schedule.builder.diversSuffix"),
    hoursBeforeSuffix: st("schedule.builder.hoursBeforeSuffix"),
    repeatLegend: st("schedule.builder.repeatLegend"),
    howOftenLabel: st("schedule.builder.howOftenLabel"),
    doesntRepeat: st("schedule.builder.doesntRepeat"),
    everyWeek: st("schedule.builder.everyWeek"),
    every2Weeks: st("schedule.builder.every2Weeks"),
    every4Weeks: st("schedule.builder.every4Weeks"),
    repeatsOnLabel: st("schedule.builder.repeatsOnLabel"),
    everyDay: st("schedule.builder.everyDay"),
    endsLabel: st("schedule.builder.endsLabel"),
    endsNever: st("schedule.builder.endsNever"),
    endsOnChoice: st("schedule.builder.endsOnChoice"),
    endsOnLabel: st("schedule.builder.endsOnLabel"),
    requestPlanHeading: st("schedule.builder.requestPlanHeading"),
    requestPlanDescription: st("schedule.builder.requestPlanDescription"),
    requestPlanRecommendation: st.raw("schedule.builder.requestPlanRecommendation"),
    requestPlanRecommendationDiversOne: st.raw(
      "schedule.builder.requestPlanRecommendationDiversOne",
    ),
    requestPlanRecommendationDiversOther: st.raw(
      "schedule.builder.requestPlanRecommendationDiversOther",
    ),
    requestPlanRecommendationCapacityOne: st.raw(
      "schedule.builder.requestPlanRecommendationCapacityOne",
    ),
    requestPlanRecommendationCapacityOther: st.raw(
      "schedule.builder.requestPlanRecommendationCapacityOther",
    ),
    requestPlanDiversOne: st.raw("schedule.builder.requestPlanDiversOne"),
    requestPlanDiversOther: st.raw("schedule.builder.requestPlanDiversOther"),
    requestPlanPersonOne: st.raw("schedule.builder.requestPlanPersonOne"),
    requestPlanPersonOther: st.raw("schedule.builder.requestPlanPersonOther"),
    requestPlanBoatRecommendationOne: st.raw("boats.requestPlanBoatRecommendationOne"),
    requestPlanBoatRecommendationOther: st.raw("boats.requestPlanBoatRecommendationOther"),
    requestPlanBoatExceeded: st("boats.requestPlanBoatExceeded"),
    requestPlanCrewSuggestionOne: st.raw("boats.requestPlanCrewSuggestionOne"),
    requestPlanCrewSuggestionOther: st.raw("boats.requestPlanCrewSuggestionOther"),
    diveModeLabel: st("boats.diveModeLabel"),
    modeBoat: st("boats.modeBoat"),
    modeShore: st("boats.modeShore"),
    modePool: st("boats.modePool"),
    boatSelectLabel: st("boats.boatSelectLabel"),
    unassignedBoat: st("boats.unassignedBoat"),
    lensLabel: st("lenses.tripFieldLabel"),
    lensNone: st("lenses.tripFieldNone"),
  };
}

/**
 * The rare half of the add panel: bounds the domain owns, and the per-dive
 * cards' shared words. Resolved here because a Client Component can neither
 * translate itself nor import the domain's limits at render time.
 */
export function scheduleBuilderMore(st: StaffTranslator, locale: string): BuilderMoreOptions {
  return {
    weekdayNames: weekdayNames(locale),
    minDays: MIN_TRIP_DAYS,
    maxDays: MAX_TRIP_DAYS,
    diveFields: {
      heading: st("shared.tripDiveFields.heading"),
      description: st.raw("shared.tripDiveFields.description"),
      twoTankTrip: st("shared.tripDiveFields.twoTankTrip"),
      diveCountTripOne: st.raw("shared.tripDiveFields.diveCountTripOne"),
      diveCountTripOther: st.raw("shared.tripDiveFields.diveCountTripOther"),
      numberOfDivesLabel: st("shared.tripDiveFields.numberOfDivesLabel"),
      diveOptionOne: st.raw("shared.tripDiveFields.diveOptionOne"),
      diveOptionOther: st.raw("shared.tripDiveFields.diveOptionOther"),
      diveLegend: st.raw("shared.tripDiveFields.diveLegend"),
      nameLabel: st("shared.tripDiveFields.nameLabel"),
      optionalHint: st("shared.tripDiveFields.optionalHint"),
      namePlaceholderFirst: st("shared.tripDiveFields.namePlaceholderFirst"),
      namePlaceholderOther: st("shared.tripDiveFields.namePlaceholderOther"),
      diveSiteLabel: st("shared.tripDiveFields.diveSiteLabel"),
      noSiteChosen: st("shared.tripDiveFields.noSiteChosen"),
      travelLabelFirst: st("shared.tripDiveFields.travelLabelFirst"),
      travelLabelOther: st("shared.tripDiveFields.travelLabelOther"),
      travelHint: st("shared.tripDiveFields.travelHint"),
      diverFacingDetailsLabel: st("shared.tripDiveFields.diverFacingDetailsLabel"),
      footerNote: st("shared.tripDiveFields.footerNote"),
    },
  };
}

/**
 * The add panel's price box in the shop's own currency, as the full trip form
 * has it: whole-number entry and a symbol-only placeholder for a zero-decimal
 * currency, where "$0.00" would be wrong twice over.
 */
export function builderPriceInput(currency: ShopCurrency, locale: string): BuilderPriceInput {
  const fractionDigits = currencyFractionDigits(currency);
  return {
    step: fractionDigits === 0 ? "1" : `0.${"0".repeat(fractionDigits - 1)}1`,
    max: maxPriceMajor(currency),
    placeholder: formatMoneyCents(0, currency, locale),
  };
}
