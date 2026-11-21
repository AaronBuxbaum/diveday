import Link from "next/link";
import type { requireShopSurface } from "@/features/accounts/session";
import type { listBoats } from "@/features/crew-and-boats/boats";
import type { listTripLenses } from "@/features/trips/trip-lenses";
import type { getTripOverview } from "@/features/trips/trip-overview";
// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
import type { StaffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { type DepthUnit, depthInUnit } from "@/lib/depth-units";
import {
  formatMoneyCents,
  formatMoneyScanned,
  formatTimeTz,
  formatWeekdayTime,
} from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { meetingPointLine, meetingPointOfRows } from "@/lib/meeting-point";
import { toShopCurrency } from "@/lib/money";
import { type FormNotice, noticeForForm, shopPath } from "@/lib/staff-notices";
import {
  type TemperatureUnit,
  temperatureInUnit,
  temperatureUnitFor,
} from "@/lib/temperature-units";
import { laterMeetingDates, laterMeetingHours } from "@/lib/trip-days";
import { clearConditionsAction, saveConditionsAction } from "../conditions-actions";
import { moveTripCrewAction, updateTripCrewAction } from "../crew-actions";
import type { DepartureDetailsSection } from "../departure-detail-sections";
import { saveDetailsSection } from "../details-actions";
import { saveRequirementsAction } from "../terms-actions";
import { admissionDisplay } from "./admission-display";
import { ConditionsOutlookSlot, ConditionsSection } from "./ConditionsSection";
import { CrewAwayWorkingList } from "./CrewAwayWorkingList";
import { CrewMoveForm } from "./CrewMoveForm";
import { CrewSection } from "./CrewSection";
import { DetailsEditor } from "./DetailsEditor";
import type { departureConditionReads } from "./departure-conditions";
import { participantTermsRows } from "./ParticipantTermsSection";
import { crewNamesOf } from "./phases/phase-slots";
import { RequirementsSection } from "./RequirementsSection";
import { boatClashText, tripCrewNotesOf } from "./trip-crew-notes";
import { tripSeatSummary } from "./trip-seat-summary";

type TripOverview = NonNullable<Awaited<ReturnType<typeof getTripOverview>>>;
type ShopSurface = Awaited<ReturnType<typeof requireShopSurface>>["shop"];

/** What Edit trip's rows are composed from: the departure's overview and the page's reads. */
export type TripAboutRowsContext = {
  overview: TripOverview;
  /** The hull's clashes with other departures; empty on a called-off one. */
  liveBoatClashes: TripOverview["boatClashes"];
  shop: ShopSurface;
  shopSlug: string;
  tripId: string;
  locale: string;
  t: StaffTranslator;
  tripNotice: FormNotice | undefined;
  shopBoats: Awaited<ReturnType<typeof listBoats>>;
  shopLenses: Awaited<ReturnType<typeof listTripLenses>>;
  automatedForecast: ReturnType<typeof departureConditionReads>["automatedForecast"];
  tideLines: ReturnType<typeof departureConditionReads>["tideLines"];
  /** The held notice keeps its editor identity after the one-shot save notice is cleared. */
  held?: { id: string; section: string | undefined };
  tell?: string;
  refundsHeld?: boolean;
  detailsEditable?: boolean;
};

/** The names of the staff assigned to this departure, in the crew's own order (`getTripCrewAssignmentsByTrip`). */
export function assignedCrewNames(overview: TripOverview): string[] {
  return crewNamesOf(overview);
}

/**
 * The crew's published read as the Conditions row's facts, in the shop's own
 * units: their sentence, the surface, the water and the visibility. The water
 * is half of what a diver dresses for (fourth review, item 54).
 */
function crewConditionFacts(
  trip: {
    conditionsSummary: string | null;
    surfaceConditions: string | null;
    waterTemperatureC: number | null;
    visibilityMeters: number | null;
  },
  depthUnit: DepthUnit,
  temperatureUnit: TemperatureUnit,
  t: StaffTranslator,
): string[] {
  return [
    trip.conditionsSummary,
    trip.surfaceConditions,
    trip.waterTemperatureC !== null
      ? t("trips.conditions.waterFact", {
          value: `${temperatureInUnit(trip.waterTemperatureC, temperatureUnit)} ${t(
            temperatureUnit === "fahrenheit"
              ? "shared.temperature.fahrenheit"
              : "shared.temperature.celsius",
          )}`,
        })
      : null,
    trip.visibilityMeters !== null
      ? t("trips.conditions.visibilityFact", {
          value: `${depthInUnit(trip.visibilityMeters, depthUnit)} ${t(
            depthUnit === "feet" ? "shared.depth.feet" : "shared.depth.meters",
          )}`,
        })
      : null,
  ].filter((part): part is string => Boolean(part));
}

/**
 * **Edit trip's rows** (ADR 20261117-trip-page-clock), each a one-line
 * summary over its editor: when, where to meet, the boat, the crew, the plan,
 * the price, who can book, the conditions, and the rarer settings. A row with
 * open work (a refusal from its own form, a missing requirements row, crew to
 * sort) renders open.
 */
function departureEditor(context: TripAboutRowsContext, section: DepartureDetailsSection) {
  const {
    overview,
    shop,
    shopSlug,
    tripId,
    locale,
    tripNotice,
    shopBoats,
    shopLenses,
    held,
    tell,
  } = context;
  const { trip, diveSiteList, tripDiveList, startWall, endWall, scheduleDays, canConfigure } =
    overview;
  return canConfigure && context.detailsEditable !== false ? (
    <DetailsEditor
      shop={shop}
      section={section}
      held={held?.section === section ? held.id : undefined}
      tell={tell}
      context={{
        action: saveDetailsSection.bind(null, shopSlug, tripId, section),
        status: noticeForForm(tripNotice, section),
        trip,
        diveSiteList,
        tripDiveList,
        startWall,
        endWall,
        dayCount: Math.max(1, scheduleDays.length),
        // The later days' own dates when the run has gaps (third UX
        // review, item 10), so a save keeps a course's weekends apart.
        laterHours: laterMeetingHours(scheduleDays, shop.timezone),
        laterDates: laterMeetingDates(
          scheduleDays.map((day) => calendarDateInTimezone(day.startsAt, shop.timezone)),
        ),
        locale,
        currency: toShopCurrency(shop.currency),
        boats: shopBoats.map((boat) => ({
          id: boat.id,
          name: boat.name,
          capacity: boat.capacity,
        })),
        lenses: shopLenses.map((lens) => ({ id: lens.id, name: lens.name })),
        hasBoatDiving: shop.hasBoatDiving,
        hasShoreDiving: shop.hasShoreDiving,
        hasPoolDiving: shop.hasPoolDiving,
        rentalItems: shop.rentalItems,
        flySafeTold: overview.flySafeTold,
      }}
    />
  ) : undefined;
}

function crewRoleOptions(t: StaffTranslator) {
  return {
    instructor: t("trips.crew.roleInstructor"),
    divemaster: t("trips.crew.roleDivemaster"),
    captain: t("trips.crew.roleCaptain"),
    crew: t("trips.crew.roleCrew"),
  };
}

function bookingTermsFor(
  trip: TripAboutRowsContext["overview"]["trip"],
  currency: string,
  locale: string,
  t: StaffTranslator,
) {
  const fromShop = (
    text: string,
    field: "depositCents" | "cancellationWindowHours" | "minimumBookings",
  ) =>
    trip.shopDefaultFields.includes(field)
      ? `${text} (${t("settings.tripDefaults.source")})`
      : text;
  const bookingTerms = [
    trip.depositCents !== null
      ? fromShop(
          t("trips.about.deposit", {
            amount: formatMoneyCents(trip.depositCents, currency, locale),
          }),
          "depositCents",
        )
      : null,
    trip.cancellationWindowHours !== null
      ? fromShop(
          t("trips.about.freeCancel", { hours: trip.cancellationWindowHours }),
          "cancellationWindowHours",
        )
      : null,
    trip.minimumBookings !== null
      ? fromShop(t("trips.about.minimumToRun", { count: trip.minimumBookings }), "minimumBookings")
      : null,
  ].filter((part): part is string => part !== null);
  return bookingTerms;
}

function departureDefinitionRows(context: TripAboutRowsContext) {
  const {
    overview,
    liveBoatClashes,
    shop,
    shopSlug,
    tripId,
    locale,
    t,
    tripNotice,
    shopBoats,
    shopLenses,
    automatedForecast,
    tideLines,
  } = context;
  const {
    trip,
    cancelled,
    staff,
    requirement,
    siteRequirement,
    scheduleDays,
    canConfigure,
    diveSites,
    crew,
  } = overview;
  const bookingPriceCents = perDiverBookingPriceCents(trip, trip.course);
  const { crewIds, tripRoleByPerson, crewGap, onShiftIds, clashes } = crew;
  const crewNotes = tripCrewNotesOf(overview, shop, locale, t);
  const { ratingLapsedNote, languageGapNote, underTargetNote, overRatioWarning } = crewNotes;
  const detailsStatus = noticeForForm(tripNotice, "details");
  const conditionsStatus = noticeForForm(tripNotice, "conditions");
  const requirementsStatus = noticeForForm(tripNotice, "requirements");
  const siteNames = diveSites.sites.map((site) => site.name);
  const planSummary = siteNames.length > 0 ? siteNames.join(" + ") : t("trips.about.noneSet");
  const requirementsSummary = admissionDisplay(trip.course, requirement, siteRequirement, t);
  const temperatureUnit = temperatureUnitFor(shop);
  const conditionParts = crewConditionFacts(trip, shop.depthUnit, temperatureUnit, t);
  // The tide stands in for the at-rest line only when there is nothing else:
  // "No conditions yet" beside a known slack would be the summary
  // contradicting its own panel. It never joins a line that already has the
  // crew's read — the strip is one line and truncates, and a full sentence
  // appended to four readings pushes the readings off the end of it.
  const conditionsSummary = trip.conditionsHold
    ? t("trips.conditions.holdOnSummary")
    : // Deliberately no tide fallback here. `tideLines[0]` is *one site's*
      // water, and the strip strips the site prefix the panel below adds for
      // exactly that reason -- so on a two-stationed-site day it stated dive
      // one's tide as the whole departure's conditions. The tide is not the
      // crew's conditions read, and the panel below already carries it in full.
      conditionParts.join(" · ") || t("trips.about.noConditions");
  const assignedCrew = assignedCrewNames(overview);
  // The fleet's row for this departure's boat, for its name on the about line.
  // A shore dive or a pool session finds nothing here.
  const boat = shopBoats.find((row) => row.id === trip.boatId);
  const bookingTerms = bookingTermsFor(trip, shop.currency, locale, t);

  // The clash is a fact about two boats that will both sail, so a called-off
  // departure drops it with the rest of the live-trip nudges — `crewClashes`
  // answers nothing for one anyway, and this keeps the two from ever
  // disagreeing on screen.
  const liveClashes = cancelled ? [] : clashes;
  // The crew row opens itself whenever there is crew work to do — nobody
  // assigned, a standing clash, a course without its instructor, a shortfall
  // against the shop's own target, or a language nobody aboard speaks. A
  // settled crew collapses to the one line that names them (principles.md §9).
  // A shop that plans no crew here is not nagged with an open editor for an
  // empty crew list; a course still is, through its own instructor gap.
  const crewRowOpen =
    Boolean(noticeForForm(tripNotice, "crew")) ||
    (shop.crewScheduleEnabled && crewIds.length === 0) ||
    liveClashes.length > 0 ||
    (!cancelled &&
      (crewGap.code !== "none" ||
        underTargetNote !== null ||
        languageGapNote !== null ||
        ratingLapsedNote !== null));

  const editorFor = (section: DepartureDetailsSection) => departureEditor(context, section);
  const crewSummary =
    assignedCrew.length > 0
      ? cachedListFormat(locale, { style: "long", type: "conjunction" }).format(assignedCrew)
      : t("trips.crew.notAssignedYet");
  const boatSummary = boat?.name ?? t("trips.about.noBoat");

  return [
    {
      id: "timing",
      label: t("trips.about.when"),
      value: [
        formatWeekdayTime(trip.startsAt, locale, shop.timezone),
        scheduleDays.length > 1 ? t("schedule.week.runsDays", { days: scheduleDays.length }) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      editorOpen: Boolean(noticeForForm(tripNotice, "timing")),
      editor: editorFor("timing"),
    },
    {
      id: "meeting",
      label: t("trips.about.meet"),
      value: meetingPointLine(meetingPointOfRows(shop, trip)),
      editorOpen: Boolean(noticeForForm(tripNotice, "meeting")),
      editor: editorFor("meeting"),
    },
    {
      id: "boat",
      label: t("trips.about.boat"),
      // The hull's clash rides on the row whose editor changes the hull.
      value:
        liveBoatClashes.length === 0 ? (
          boatSummary
        ) : (
          <>
            {boatSummary}
            {liveBoatClashes.map((clash) => (
              <Link
                key={clash.otherTripId}
                href={shopPath(shopSlug, "trips", clash.otherTripId)}
                className="mt-0.5 block font-medium text-danger hover:underline"
              >
                {boatClashText(t, clash)}
              </Link>
            ))}
          </>
        ),
      editorOpen: Boolean(noticeForForm(tripNotice, "boat")),
      editor: editorFor("boat"),
    },
    // **On every departure, whatever the crew schedule says**: who is aboard
    // is manifest data, not planning (ADR 20261005-crew-schedule-is-a-setting).
    {
      id: "about-crew",
      label: t("trips.about.crew"),
      value: crewSummary,
      // **A row with open work stays open** (principles.md §9, read the other way).
      editorOpen: crewRowOpen,
      /* Who's aboard is manifest accuracy (glossary): open to all staff.
   Per-person assign/unassign (updateTripCrewAction), the same mutation
   the schedule board uses, so two staff editing crew at once cannot
   clobber each other (Lens 17 task 139). */
      editor: (
        <>
          <CrewSection
            shopSlug={shopSlug}
            tripId={tripId}
            staff={staff}
            crewIds={crewIds}
            crewRoles={Object.fromEntries(tripRoleByPerson)}
            // Canceled departures have no live-trip staffing warnings.
            onShiftIds={cancelled ? null : onShiftIds}
            awayPersonIds={cancelled ? [] : crew.awayPersonIds}
            clashes={liveClashes}
            crewGapCode={cancelled ? "none" : crewGap.code}
            bookingInstructorPresent={crew.rosterInWaterCrew.instructorCount > 0}
            updateCrewAction={updateTripCrewAction.bind(null, shopSlug)}
            copy={{
              heading: t("trips.crew.heading"),
              courseNeedsInstructor: t("trips.crew.courseNeedsInstructor"),
              overRatioWarning,
              underTargetNote: cancelled ? null : underTargetNote,
              languageGapNote: cancelled ? null : languageGapNote,
              ratingLapsedNote: cancelled ? null : ratingLapsedNote,
              noStaff: t("trips.crew.noCrew"),
              notAssignedYet: t("trips.crew.notAssignedYet"),
              awayWarning: t("trips.crew.awayWarning"),
              assignLabel: t("trips.crew.assignLabel"),
              assignOption: t("trips.crew.assignOption"),
              unassignAria: t.raw("trips.crew.unassignAria"),
              assignFailed: t("trips.crew.assignFailed"),
              // `t.raw`: `{name}` is whoever the staffer just picked (src/i18n/fill.ts).
              assignClash: t.raw("trips.crew.assignClash"),
              // `t.raw`: `{departure}` is the other boat's own title (src/i18n/fill.ts).
              clash: t.raw("trips.crew.clash"),
              roleAria: t.raw("trips.crew.roleAria"),
              roleUnspecified: t("trips.crew.roleUnspecified"),
              roleOptions: crewRoleOptions(t),
              onShift: t("trips.crew.onShift"),
              notOnShift: t("trips.crew.notOnShift"),
              manageShifts: shop.crewScheduleEnabled ? t("trips.crew.manageShifts") : null,
            }}
          />
          {/* One step to another boat that day (issue #4474). */}
          {crewMoveFormFor(context)}
          {/* "No longer working it" (#2678, dock review S2). */}
          <CrewAwayWorkingList
            shopSlug={shopSlug}
            tripId={tripId}
            people={crew.awayWorking}
            t={t}
          />
        </>
      ),
    },
    {
      id: "plan",
      label: t("trips.about.plan"),
      value: planSummary,
      editorOpen: Boolean(noticeForForm(tripNotice, "plan")),
      editor: editorFor("plan"),
    },
    {
      // Existing Set a price links land on this object.
      id: "details",
      label: t("trips.about.price"),
      value: (
        <>
          {/* The price alone; the seats are their own row (review nit 13). */}
          {bookingPriceCents === null
            ? cancelled
              ? null
              : t("trips.details.summaryNoPrice")
            : formatMoneyScanned(bookingPriceCents, shop.currency, locale)}
          {bookingTerms.length > 0 ? (
            <span className="block text-sm text-muted">{bookingTerms.join(" · ")}</span>
          ) : null}
        </>
      ),
      editorOpen: Boolean(noticeForForm(tripNotice, "booking")) || Boolean(detailsStatus),
      editor: editorFor("booking"),
    },
    {
      // A fact, not a form: the capacity itself is edited in the Price row.
      id: "seats",
      label: t("trips.about.seats"),
      value: tripSeatSummary(
        t,
        trip.booked,
        trip.sellableCapacity,
        boat?.certifiedPassengers ?? null,
      ),
    },
    {
      id: "requirements",
      label: t("trips.about.whoCanBook"),
      value: requirementsSummary,
      // A course session's gate is frozen (`saveRequirementsAction` refuses to
      // edit it), so its row opens onto where the rules come from rather than
      // onto a form, and the word on the control says View.
      editLabel: trip.course ? t("trips.about.view") : undefined,
      // Fail-closed, open: with no requirements row readiness blocks every diver.
      editorOpen: Boolean(requirementsStatus) || requirement === null,
      editor: canConfigure ? (
        <RequirementsSection
          action={saveRequirementsAction.bind(null, shopSlug, tripId)}
          status={requirementsStatus}
          trip={trip}
          requirement={requirement}
          siteRequirement={siteRequirement}
          siteNames={diveSites.sites.map((site) => site.name)}
          locale={locale}
        />
      ) : undefined,
    },
    {
      id: "conditions",
      label: t("trips.about.conditions"),
      value: conditionsSummary,
      editorOpen: Boolean(conditionsStatus),
      /* Conditions are crew-entered (glossary): open to all staff. Its fields
   are uncontrolled (`defaultValue`), so keying on the fields themselves
   forces the remount `defaultValue` needs on any actual change (ADR
   20260802-cache-components-cross-render-state). */
      editor: (
        <ConditionsSection
          key={[
            trip.waterTemperatureC,
            trip.visibilityMeters,
            trip.surfaceConditions,
            trip.conditionsSummary,
          ].join("|")}
          saveAction={saveConditionsAction.bind(null, shopSlug, tripId)}
          clearAction={clearConditionsAction.bind(null, shopSlug, tripId)}
          status={conditionsStatus}
          trip={trip}
          locale={locale}
          timezone={shop.timezone}
          temperatureUnit={temperatureUnit}
          depthUnit={shop.depthUnit}
          outlook={
            <ConditionsOutlookSlot
              locale={locale}
              timezone={shop.timezone}
              temperatureUnit={temperatureUnit}
              depthUnit={shop.depthUnit}
              automatedForecast={automatedForecast}
              tideLines={tideLines}
            />
          }
        />
      ),
    },
    ...participantTermsRows({ ...overview, shop, locale, tripNotice, shopSlug }),
    {
      id: "departure-details",
      label: t("trips.about.nameAndDescription"),
      value: (
        <>
          {trip.title}
          {trip.lensId ? (
            <span className="block text-sm text-muted">
              {shopLenses.find((lens) => lens.id === trip.lensId)?.name}
              {trip.shopDefaultFields.includes("lensId")
                ? ` (${t("settings.tripDefaults.source")})`
                : ""}
            </span>
          ) : null}
        </>
      ),
      editorOpen: Boolean(noticeForForm(tripNotice, "departure")),
      editor: editorFor("departure"),
    },
  ];
}

/**
 * The rows Edit trip folds into one closed "More settings" group: rare,
 * per-trip, and never what a staffer opened the page for.
 */
export const MORE_SETTINGS_ROWS: ReadonlySet<string> = new Set([
  "participant-terms",
  "departure-details",
  "site-history",
  "open-seats",
]);

/** "Move to another boat": the crew here and the day's other boats, while the departure is editable. */
function crewMoveFormFor(context: TripAboutRowsContext) {
  const { overview, shop, shopSlug, tripId, locale, t } = context;
  if (overview.cancelled || context.detailsEditable === false) return null;
  const { crewIds } = overview.crew;
  return (
    <CrewMoveForm
      tripId={tripId}
      crew={overview.staff
        .filter((entry) => crewIds.includes(entry.person.id))
        .map((entry) => ({ id: entry.person.id, fullName: entry.person.fullName }))}
      targets={overview.crewMoveTargets.map((target) => ({
        id: target.id,
        label: `${formatTimeTz(target.startsAt, locale, shop.timezone)} · ${target.title}`,
      }))}
      action={moveTripCrewAction.bind(null, shopSlug, tripId)}
      copy={{
        trigger: t("trips.crew.move.trigger"),
        who: t("trips.crew.move.who"),
        to: t("trips.crew.move.to"),
        choose: t("trips.crew.move.choose"),
        submit: t("trips.crew.move.submit"),
        pending: t("trips.crew.move.pending"),
      }}
    />
  );
}

/** A completed departure keeps all facts but none of its definition editors. */
export function tripAboutRows(context: TripAboutRowsContext) {
  const rows = departureDefinitionRows(context);
  if (context.detailsEditable !== false) return rows;
  return rows.map((row) => {
    if (row.id === "about-crew")
      return {
        ...row,
        editLabel: context.t("trips.about.correctCrewRecord"),
        editorOpen: Boolean(noticeForForm(context.tripNotice, "crew")),
      };
    return { ...row, editor: undefined, editorOpen: false };
  });
}
