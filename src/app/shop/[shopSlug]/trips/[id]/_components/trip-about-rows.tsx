import Link from "next/link";
import type { listBoats } from "@/db/boats";
import type { listTripLenses } from "@/db/trip-lenses";
import type { getTripOverview } from "@/db/trips";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
import type { StaffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { type DepthUnit, depthInUnit } from "@/lib/depth-units";
import { formatShortDate, weekdayNames } from "@/lib/format";
import { meetingPointLine, meetingPointOfRows } from "@/lib/meeting-point";
import { toShopCurrency } from "@/lib/money";
import type { requireShopSurface } from "@/lib/session";
import { type FormNotice, noticeForForm, shopPath } from "@/lib/staff-notices";
import {
  type TemperatureUnit,
  temperatureInUnit,
  temperatureUnitFor,
} from "@/lib/temperature-units";
import { laterMeetingDates } from "@/lib/trip-days";
import { clearConditionsAction, saveConditionsAction } from "../conditions-actions";
import { updateTripCrewAction } from "../crew-actions";
import { saveDetails } from "../details-actions";
import {
  cancelOffCadenceSeriesAction as cancelOffCadence,
  updateSeriesCadenceAction,
} from "../series-actions";
import { saveRequirementsAction } from "../terms-actions";
import { ConditionsOutlookSlot, ConditionsSection } from "./ConditionsSection";
import { CrewAwayWorkingList } from "./CrewAwayWorkingList";
import { CrewSection } from "./CrewSection";
import { DetailsEditor } from "./DetailsEditor";
import type { departureConditionReads } from "./departure-conditions";
import { repeatsRowText } from "./details-rows";
import { participantTermsRows } from "./ParticipantTermsSection";
import { RequirementsSection } from "./RequirementsSection";
import { SeriesCadenceEditor } from "./SeriesSection";
import { boatClashText, type tripCrewNotes } from "./trip-crew-notes";

type TripOverview = NonNullable<Awaited<ReturnType<typeof getTripOverview>>>;
type ShopSurface = Awaited<ReturnType<typeof requireShopSurface>>["shop"];

/** What the Details tab's About rows are composed from: the departure's overview and the page's reads. */
export type TripAboutRowsContext = {
  overview: TripOverview;
  crewNotes: ReturnType<typeof tripCrewNotes>;
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
  /** A retime's held reschedule notice, on the save that set it going. */
  held?: string;
  tell?: string;
  refundsHeld?: boolean;
};

/** The names of the staff assigned to this departure, in the shop's staff order. */
export function assignedCrewNames(overview: TripOverview): string[] {
  return overview.staff
    .filter((entry) => overview.crew.crewIds.includes(entry.person.id))
    .map((entry) => entry.person.fullName);
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
 * **The Details tab's About rows**, each a one-line summary over its editor:
 * the plan, the conditions, who can book, the participant terms, the boat and
 * crew, and the cadence a repeating departure keeps. A row with open work — a
 * refusal from its own form, a missing requirements row, crew to sort —
 * renders open.
 */
export function tripAboutRows(context: TripAboutRowsContext) {
  const {
    overview,
    crewNotes,
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
    held,
    tell,
  } = context;
  const {
    trip,
    cancelled,
    staff,
    requirement,
    diveSiteList,
    tripDiveList,
    siteRequirement,
    series,
    scheduleDays,
    canConfigure,
    offCadence,
    diveSites,
    startWall,
    endWall,
    crew,
  } = overview;
  const { crewIds, tripRoleByPerson, crewGap, onShiftIds, clashes } = crew;
  const { ratingLapsedNote, languageGapNote, underTargetNote, overRatioWarning } = crewNotes;
  const detailsStatus = noticeForForm(tripNotice, "details");
  const conditionsStatus = noticeForForm(tripNotice, "conditions");
  const requirementsStatus = noticeForForm(tripNotice, "requirements");
  const seriesStatus = noticeForForm(tripNotice, "series");
  const siteNames = diveSites.sites.map((site) => site.name);
  const planSummary = siteNames.length > 0 ? siteNames.join(" + ") : t("trips.about.noneSet");
  const requirementsSummary =
    requirement === null
      ? t("trips.about.noRequirements")
      : [
          requirement.minimumCertificationLevel
            ? t("trips.requirements.summaryCert", {
                level: t(CERTIFICATION_LEVEL_KEYS[requirement.minimumCertificationLevel]),
              })
            : null,
          requirement.requiresWaiver ? t("trips.requirements.summaryWaiver") : null,
          !trip.course && requirement.requiresPayment
            ? t("trips.requirements.summaryPayment")
            : null,
          ...(!trip.course
            ? requirement.requiredSpecialties.map((specialty) =>
                t("trips.requirements.summarySpecialtyCard", {
                  specialty: t(SPECIALTY_KEYS[specialty]),
                }),
              )
            : []),
          !trip.course && requirement.requiresNitrox
            ? t("trips.requirements.summaryNitroxCard")
            : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · ") || t("trips.requirements.summaryNoneRequired");
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
  const boatName = boat?.name;
  const boatAndCrew = [boatName, ...assignedCrew].filter((part): part is string => Boolean(part));
  const boatCrewSummary = boatAndCrew.join(" · ") || t("trips.about.noBoat");

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

  return [
    {
      id: "details",
      label: t("trips.about.plan"),
      // The missing price rides on the row rather than inside the editor
      // it is about: it is the one thing about the plan that is a
      // problem, and the board's "Set a price for …" link lands here
      // (task 150, UX persona lens 17).
      value:
        trip.priceCents === null && !cancelled ? (
          <>
            {planSummary}
            <span className="mt-0.5 block font-medium text-warning-strong">
              {t("trips.details.summaryNoPrice")}
            </span>
          </>
        ) : (
          planSummary
        ),
      editorOpen: Boolean(detailsStatus),
      editor: canConfigure ? (
        <DetailsEditor
          shop={shop}
          held={held}
          tell={tell}
          context={{
            action: saveDetails.bind(null, shopSlug, tripId),
            status: detailsStatus,
            trip,
            diveSiteList,
            tripDiveList,
            startWall,
            endWall,
            dayCount: Math.max(1, scheduleDays.length),
            // The later days' own dates when the run has gaps (third UX
            // review, item 10), so a save keeps a course's weekends apart.
            laterDates: laterMeetingDates(
              scheduleDays.map((day) => calendarDateInTimezone(day.startsAt, shop.timezone)),
            ),
            locale,
            currency: toShopCurrency(shop.currency),
            boats: shopBoats.map((boat) => ({ id: boat.id, name: boat.name })),
            lenses: shopLenses.map((lens) => ({ id: lens.id, name: lens.name })),
            hasBoatDiving: shop.hasBoatDiving,
            hasShoreDiving: shop.hasShoreDiving,
            hasPoolDiving: shop.hasPoolDiving,
            rentalItems: shop.rentalItems,
            flySafeTold: overview.flySafeTold,
          }}
        />
      ) : undefined,
    },
    // **Where the boat meets** (UX review 2026-10-13, item 18): the diver's
    // `/ready` and every message say it, and until this no staff page did —
    // it lived only as two fields inside the plan's editor, which is still
    // where it changes. The shop's own door when the departure names none.
    {
      id: "meeting",
      label: t("trips.about.meetingPoint"),
      value: meetingPointLine(meetingPointOfRows(shop, trip)),
    },
    {
      id: "conditions",
      label: t("trips.about.conditions"),
      value: conditionsSummary,
      editorOpen: Boolean(conditionsStatus),
      /* Conditions are crew-entered (glossary) — open to all staff. Its
   fields are uncontrolled (`defaultValue`, not `value`), so a save
   or clear that lands via a same-route re-render rather than a
   fresh mount leaves the old value on screen — the same
   cacheComponents-can-skip-a-remount class ADR
   20260802-cache-components-cross-render-state and ADR
   20260801-cache-components-activity-state both hit, just in the
   opposite direction. Keying on the fields themselves (not
   `conditionsUpdatedAt`, which the e2e harness's frozen clock
   would hold identical across a save-then-clear in the same test)
   forces the remount `defaultValue` needs on any actual change to
   what these inputs show. */
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
    {
      id: "requirements",
      label: t("trips.about.whoCanBook"),
      value: requirementsSummary,
      // A course session's gate is frozen — `saveRequirementsAction`
      // refuses to edit it — so its row opens onto where the rules come
      // from rather than onto a form, and says so in the word on the
      // control.
      // Fail-closed, open: with no requirements row readiness blocks
      // every diver, so that state may never wait behind a tap. A frozen
      // course gate opens for the opposite reason — one read-only
      // sentence has nothing worth folding away.
      editorOpen: Boolean(requirementsStatus) || requirement === null || Boolean(trip.course),
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
    ...participantTermsRows({ ...overview, shop, locale, tripNotice, shopSlug }),
    // **On every departure, whatever the crew schedule says**: who
    // is aboard is manifest data (the crew roll call, the souls-on-
    // board count), not planning (ADR 20261005-crew-schedule-is-a-setting).
    {
      id: "about-crew",
      label: t("trips.about.boatAndCrew"),
      // **A row with open work stays open** (principles.md §9's
      // "collapse the settled row", read the other way). A boat with
      // nobody on it, a clash, a course with no instructor, a shortfall
      // against the shop's own target or a language nobody aboard
      // speaks are all things a staffer is here to fix — and the two
      // safety-adjacent ones are also linked from the pulse above,
      // which is what makes `#crew` land on something rather than on a
      // closed row.
      editorOpen: crewRowOpen,
      /* Who's aboard is manifest accuracy (glossary) — open to all
   staff. Per-person assign/unassign (updateTripCrewAction), the
   same mutation the schedule board uses — not a whole-set replace
   — so two staff editing crew at once can no longer clobber each
   other (Lens 17 task 139). */
      editor: (
        <>
          <CrewSection
            shopSlug={shopSlug}
            tripId={tripId}
            staff={staff}
            crewIds={crewIds}
            crewRoles={Object.fromEntries(tripRoleByPerson)}
            // A cancelled departure isn't sailing, so its crew panel drops
            // the live-trip nudges — the ratio gates, the shop's target,
            // and the shift-coverage badges are all about a boat that will
            // leave.
            onShiftIds={cancelled ? null : onShiftIds}
            clashes={liveClashes}
            crewGapCode={cancelled ? "none" : crewGap.code}
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
              assignLabel: t("trips.crew.assignLabel"),
              assignOption: t("trips.crew.assignOption"),
              unassignAria: t.raw("trips.crew.unassignAria"),
              assignFailed: t("trips.crew.assignFailed"),
              // `t.raw`: `{name}` is whoever the staffer just picked,
              // which only the component knows (src/i18n/fill.ts).
              assignClash: t.raw("trips.crew.assignClash"),
              // `t.raw`: `{departure}` is the other boat's own title,
              // which only the component has per row (src/i18n/fill.ts).
              clash: t.raw("trips.crew.clash"),
              roleAria: t.raw("trips.crew.roleAria"),
              roleUnspecified: t("trips.crew.roleUnspecified"),
              roleOptions: {
                instructor: t("trips.crew.roleInstructor"),
                divemaster: t("trips.crew.roleDivemaster"),
                captain: t("trips.crew.roleCaptain"),
                crew: t("trips.crew.roleCrew"),
              },
              onShift: t("trips.crew.onShift"),
              notOnShift: t("trips.crew.notOnShift"),
              manageShifts: shop.crewScheduleEnabled ? t("trips.crew.manageShifts") : null,
            }}
          />
          {/* "No longer working it" (#2678, dock review S2). */}
          <CrewAwayWorkingList
            shopSlug={shopSlug}
            tripId={tripId}
            people={crew.awayWorking}
            t={t}
          />
        </>
      ),
      // The Details form is the door that changes the boat, and it
      // redirects here, so the hull's clash rides on this row as
      // well as on the Divers tab's pulse.
      value:
        liveBoatClashes.length === 0 ? (
          boatCrewSummary
        ) : (
          <>
            {boatCrewSummary}
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
    },
    {
      id: "series",
      label: t("trips.about.repeats"),
      value: repeatsRowText(t, locale, series),
      editorOpen: Boolean(seriesStatus),
      editor:
        canConfigure && series ? (
          <SeriesCadenceEditor
            intervalWeeks={series.intervalWeeks}
            weekdays={series.weekdayMask}
            endsOn={series.endsOn}
            anchorDate={series.anchorDate}
            offCadence={offCadence.map((date) => ({
              id: date.id,
              title: date.title,
              // Formatted here, where the request locale and the shop's
              // zone both are — the panel is handed words, never
              // instants.
              label: formatShortDate(date.startsAt, locale, shop.timezone),
              booked: date.booked,
            }))}
            weekdayNames={weekdayNames(locale)}
            status={seriesStatus}
            cadenceAction={updateSeriesCadenceAction.bind(null, shopSlug, tripId, series.id)}
            cancelOffCadenceAction={cancelOffCadence.bind(null, shopSlug, tripId, series.id)}
            refundsHeld={context.refundsHeld}
            locale={locale}
          />
        ) : undefined,
    },
  ];
}
