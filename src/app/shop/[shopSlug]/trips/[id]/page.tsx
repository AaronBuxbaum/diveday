import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { canPersonConfigureTrips } from "@/db/authz";
import { hasTripBlowout } from "@/db/blowouts";
import { getDb } from "@/db/client";
import { listDiveSites } from "@/db/dive-sites";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { listRecapPhotosForTrip } from "@/db/recap";
import { getShopById } from "@/db/shops";
import { crewShiftCoverage } from "@/db/staffing";
import {
  getTripCrewAssignments,
  getTripSeriesSummary,
  getTripWithBooked,
  listStaff,
  listTripDives,
  listTripScheduleDays,
} from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { courseCrewGap, DSD_RATIO } from "@/lib/course-ratios";
import { countInWaterCrew } from "@/lib/crew-roles";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicTripPath } from "@/lib/public-routes";
import { recurrenceSummary } from "@/lib/recurrence";
import { requireStaffSession } from "@/lib/session";
import { noticeForForm } from "@/lib/staff-notices";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { summarizeTripDiveSites } from "@/lib/trip-dives";
import { capacityLabel, isFull } from "@/lib/trips";
import { utcToWallTime } from "@/lib/zoned";
import { ConditionsSection } from "./_components/ConditionsSection";
import { CopyLinkButton } from "./_components/CopyLinkButton";
import { CrewSection } from "./_components/CrewSection";
import { DetailsSection } from "./_components/DetailsSection";
import { RecapNoteSection } from "./_components/RecapNoteSection";
import { RecapPhotoGallery } from "./_components/RecapPhotoGallery";
import { RequirementsSection } from "./_components/RequirementsSection";
import { recurrenceSummaryText, SeriesSection } from "./_components/SeriesSection";
import { resolveTripNotice, TripNoticeBanner } from "./_components/TripNoticeBanner";
import {
  applySeriesDetailsAction,
  cancelSeriesAction,
  cancelTripAction,
  clearConditionsAction,
  deleteRecapPhotoAction,
  extendSeriesAction,
  reinstateTripAction,
  saveConditionsAction,
  saveDetails,
  saveRecapShoutoutAction,
  saveRequirementsAction,
  updateTripCrewAction,
} from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Manage trip — DiveDay",
};

/**
 * Overview is *what the dive is*: details, dive plan, conditions, requirements,
 * and crew. Who is attending — the roster, wait list, and every per-diver
 * action — lives on the Guests tab; the day-of boarding and roll call live on
 * the Manifest. Keeping this page free of the roster is what gives each action
 * a single home.
 */
export default async function ManageTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{
    notice?: string;
    count?: string;
    /** Which form on this page the notice answers — see `resolveTripNotice`. */
    form?: string;
    /** Signed, and verified against this route's own `id` — src/lib/trip-admission-gate.ts. */
    gate?: string | string[];
  }>;
}) {
  // The session, route params, and db handle don't depend on one another —
  // resolve them together instead of serially.
  const [session, { shopSlug, id: tripId }, { notice, count, form, gate }, db] = await Promise.all([
    requireStaffSession(),
    params,
    searchParams,
    getDb(),
  ]);
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  // Locale and the trip row both depend on `shop` but not on each other.
  const [locale, trip] = await Promise.all([
    requestLocale(shop.defaultLocale),
    getTripWithBooked(db, shop.id, tripId),
  ]);
  const t = staffTranslator(locale);
  if (!trip) notFound();
  const [
    staff,
    crewAssignments,
    requirement,
    diveSiteList,
    tripDiveList,
    siteRequirement,
    series,
    scheduleDays,
    canConfigure,
    recapPhotos,
    blowoutCalled,
  ] = await Promise.all([
    listStaff(db, shop.id),
    getTripCrewAssignments(db, shop.id, tripId),
    getTripRequirements(db, shop.id, tripId),
    listDiveSites(db, shop.id),
    listTripDives(db, shop.id, tripId),
    getTripSiteRequirement(db, shop.id, tripId),
    getTripSeriesSummary(db, shop.id, tripId),
    listTripScheduleDays(db, shop.id, tripId),
    canPersonConfigureTrips(db, shop.id, session.user.personId),
    listRecapPhotosForTrip(db, shop.id, tripId),
    // Whether this trip's cancellation was a called blow-out — the cascade
    // record is the surface a weather morning is worked from, so the trip page
    // must always offer the way back to it (ADR 20260804-blowout-cascade).
    hasTripBlowout(db, shop.id, tripId),
  ]);
  // Where this departure goes, composed from the dives already loaded above —
  // no second query, and the same answer the public schedule card gives.
  const diveSites = summarizeTripDiveSites(
    tripDiveList.map(({ dive, diveSite }) => ({
      diveNumber: dive.diveNumber,
      site: diveSite ? { id: diveSite.id, name: diveSite.name } : null,
    })),
  );
  const startWall = utcToWallTime(trip.startsAt, shop.timezone);
  // Day one's window, not the trip's whole span: a multi-day departure ends on
  // its *last* day, and the details editor's Departs/Returns boxes describe
  // one day that the day count then repeats.
  const firstDay = scheduleDays[0];
  const endWall = utcToWallTime(firstDay?.endsAt ?? trip.endsAt, shop.timezone);
  const cancelled = trip.status === "cancelled";
  const crewIds = crewAssignments.map((entry) => entry.personId);
  const tripRoleByPerson = new Map(
    crewAssignments.map((entry) => [entry.personId, entry.tripRole] as const),
  );
  const assignedCrew = staff.filter((entry) => crewIds.includes(entry.person.id));
  // Staff can freely change crew after divers are already booked (H-14 lets
  // any staff member do this — it's day-of operating work). `courseCrewGap`
  // (src/lib/course-ratios.ts) is the one computation of "does this course
  // session have enough crew", also consumed by the staffing coverage list
  // and the Today queue (docs/product/archive/ux-personas-20260730-findings.md,
  // Lens 17 task 151) — over_ratio is the visible nudge to fix a ratio-gated
  // session before sailing, never a retroactive block on the bookings already
  // taken.
  //
  // Who counts as an instructor or an in-water certified assistant is
  // `countInWaterCrew` (src/lib/crew-roles.ts) — one definition shared with the
  // booking gate, the staffing window, and Today, so a divemaster rostered as
  // this trip's captain stops buying two students' worth of capacity here too
  // (DOM-M3).
  const crewGap = courseCrewGap({
    course: trip.course,
    ...countInWaterCrew(
      assignedCrew.map((entry) => ({
        tripRole: tripRoleByPerson.get(entry.person.id) ?? null,
        shopRoles: entry.roles,
      })),
    ),
    booked: trip.booked,
  });
  // Two rules, two sentences: the entry-level cap is PADI's published Open
  // Water training figure and a certified assistant raises it; the intro cap is
  // PADI's tighter published Discover Scuba open-water figure (HD-6) that an
  // assistant does not move. One generic string told a DSD manager to add a
  // divemaster, which cannot work, and cited the wrong PADI number at them. The
  // per-instructor figure is interpolated from `DSD_RATIO` so the sentence
  // cannot drift away from the cap the gate actually enforces.
  const overRatioWarning =
    crewGap.code !== "over_ratio"
      ? null
      : crewGap.ratio === "intro"
        ? t("trips.detail.overRatioWarningIntro", {
            booked: crewGap.booked,
            cap: crewGap.capacity,
            perInstructor: DSD_RATIO.openWaterStudentsPerInstructor,
          })
        : t("trips.detail.overRatioWarning", { booked: crewGap.booked, cap: crewGap.capacity });
  // The other half of the shift ↔ crew cross-link (Lens 17 task 165): whether
  // each assigned crew member actually has a working shift covering this
  // sailing, read straight from CrewSection instead of a separate trip to
  // the staffing page.
  const onShiftIds = [...(await crewShiftCoverage(db, shop.id, trip, crewIds))];
  const capacityLabelValue = capacityLabel(trip);
  const capacityText =
    capacityLabelValue.kind === "full"
      ? t("shared.capacity.full")
      : t("shared.capacity.spotsLeft", { count: capacityLabelValue.remaining });

  // One resolution, handed to the section it belongs to. Whatever no rendered
  // section claims — a page-level permission refusal, or a section this
  // staffer's role means we never rendered — falls through to the banner.
  const tripNotice = resolveTripNotice({ notice, count, form, gate, tripId, locale });
  const sectionsOnPage = new Set([
    ...(canConfigure ? ["details", "requirements"] : []),
    "conditions",
    "recap-note",
    // The gallery renders nothing at all once the last photo is gone, so the
    // removal that emptied it has no section to land in and falls back.
    ...(recapPhotos.length > 0 ? ["recap-photos"] : []),
    "lifecycle",
    ...(canConfigure && series ? ["series"] : []),
  ]);
  const lifecycleStatus = noticeForForm(tripNotice, "lifecycle");
  const pageNotice = tripNotice && sectionsOnPage.has(tripNotice.form) ? undefined : tripNotice;

  return (
    <>
      <FlashParams params={["notice", "count", "form"]} />
      <ShopPageHeader
        eyebrow={t("trips.detail.eyebrow")}
        title={trip.title}
        actions={
          <>
            <Link
              href={publicTripPath(shopSlug, tripId)}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("trips.detail.viewBookingPage")}
            </Link>
            <CopyLinkButton
              path={publicTripPath(shopSlug, tripId)}
              label={t("trips.detail.copyBookingLink")}
              copiedLabel={t("trips.detail.linkCopied")}
              failedLabel={t("trips.detail.linkCopyFailed")}
            />
          </>
        }
        meta={
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              {cancelled ? (
                <Badge tone="danger">{t("trips.detail.cancelledBadge")}</Badge>
              ) : (
                // A sold-out boat is a win worth noticing, not a quiet state
                // (design/principles.md #3) — "success" stands out where
                // "neutral" would recede.
                <Badge tone={isFull(trip) ? "success" : "primary"} tabularNums>
                  {capacityText}
                </Badge>
              )}
              <span className="text-muted">
                {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
                {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}
              </span>
            </div>
            {scheduleDays.length > 1 ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span>{t("trips.detail.meetingDaysSummary", { count: scheduleDays.length })}</span>
                {scheduleDays.map((day) => (
                  <span key={day.id}>
                    {t("trips.detail.dayLabel", {
                      number: day.dayNumber,
                      date: formatShortDate(day.startsAt, locale, shop.timezone),
                      timeRange: formatTimeRangeTz(day.startsAt, day.endsAt, locale, shop.timezone),
                    })}
                  </span>
                ))}
              </div>
            ) : null}
            {trip.course ? (
              <p className="text-sm font-medium text-primary">
                {t.rich("trips.detail.courseSession", {
                  title: trip.course.title,
                  course: (chunks) => (
                    <Link
                      href={`/shop/${shopSlug}/courses/${trip.course?.slug}/edit`}
                      className="hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            ) : null}
            {/* Read off the dives, never `trip.diveSite` — that column is only
                dive one's site copied onto the trip row, so it named one site
                for a two-site day and named none at all when the tank without
                a site was the first one. */}
            {diveSites.sites.length > 0 || diveSites.undecidedDives > 0 ? (
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                {diveSites.sites.length > 0 ? (
                  <>
                    <span>
                      {diveSites.sites.length === 1
                        ? t("trips.detail.diveSiteLabel")
                        : t("trips.detail.diveSitesLabel")}
                    </span>
                    {/* Each site keeps its own link into the library card, so a
                        two-site day is two destinations — which rules out an
                        `Intl.ListFormat` join. The separator is punctuation
                        between links, not a word to translate. */}
                    {diveSites.sites.map((site, index) => (
                      <span key={site.id} className="flex items-center gap-x-2">
                        {index > 0 ? <span aria-hidden="true">·</span> : null}
                        <Link
                          href={`/shop/${shopSlug}/dive-sites/${site.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {site.name}
                        </Link>
                      </span>
                    ))}
                  </>
                ) : null}
                {diveSites.undecidedDives > 0 ? (
                  <span className="flex items-center gap-x-2">
                    {diveSites.sites.length > 0 ? <span aria-hidden="true">·</span> : null}
                    {t("trips.detail.divesWithoutSite", { count: diveSites.undecidedDives })}
                  </span>
                ) : null}
              </p>
            ) : null}
            {series ? (
              <p className="text-sm text-muted">
                {t("trips.detail.seriesPart", {
                  summary: recurrenceSummaryText(
                    t,
                    recurrenceSummary({
                      frequency: "weekly",
                      intervalWeeks: series.intervalWeeks,
                      occurrenceCount: series.occurrenceCount,
                    }),
                  ),
                  count: series.scheduledCount,
                })}
              </p>
            ) : null}
          </div>
        }
      />

      <TripNoticeBanner notice={pageNotice} locale={locale} />

      {/* No "you're viewing this trip" notice for staff without configure
          rights. The editable sections simply aren't rendered, which is the
          same thing said without a paragraph explaining the role model to
          someone who cannot change it (ADR 20260724-role-gated-surfaces-hide-
          not-explain). */}

      {canConfigure ? (
        <DetailsSection
          action={saveDetails.bind(null, shopSlug, tripId)}
          status={noticeForForm(tripNotice, "details")}
          trip={trip}
          diveSiteList={diveSiteList}
          tripDiveList={tripDiveList}
          startWall={startWall}
          endWall={endWall}
          dayCount={Math.max(1, scheduleDays.length)}
          locale={locale}
          currency={toShopCurrency(shop.currency)}
        />
      ) : null}

      {/* Conditions are crew-entered (glossary) — open to all staff. Its
          fields are uncontrolled (`defaultValue`, not `value`), so a save or
          clear that lands via a same-route re-render rather than a fresh
          mount leaves the old value on screen — the same
          cacheComponents-can-skip-a-remount class ADR
          20260802-cache-components-cross-render-state and ADR
          20260801-cache-components-activity-state both hit, just in the
          opposite direction (unresettable state that needs a forced remount,
          not state that needs to survive one). Keying on the fields
          themselves (not `conditionsUpdatedAt`, which the e2e harness's
          frozen clock would hold identical across a save-then-clear in the
          same test) forces the remount `defaultValue` needs on any actual
          change to what these inputs show, republish-with-different-values
          included — not just the set/cleared transition this bug was found on. */}
      <ConditionsSection
        key={[
          trip.waterTemperatureC,
          trip.visibilityMeters,
          trip.surfaceConditions,
          trip.conditionsSummary,
        ].join("|")}
        saveAction={saveConditionsAction.bind(null, shopSlug, tripId)}
        clearAction={clearConditionsAction.bind(null, shopSlug, tripId)}
        status={noticeForForm(tripNotice, "conditions")}
        trip={trip}
        locale={locale}
        timezone={shop.timezone}
        temperatureUnit={temperatureUnitFor(shop)}
        depthUnit={shop.depthUnit}
      />

      <RecapNoteSection
        action={saveRecapShoutoutAction.bind(null, shopSlug, tripId)}
        status={noticeForForm(tripNotice, "recap-note")}
        shoutout={trip.recapShoutout}
        locale={locale}
      />

      {/* Diver-shared recap photos sit beside the crew's own shout-out — both
          are the post-trip recap's content, and moderating one moved off the
          Guests tab to slim it (task 156, UX persona lens 17). */}
      <RecapPhotoGallery
        photos={recapPhotos}
        removeAction={deleteRecapPhotoAction.bind(null, shopSlug, tripId)}
        status={noticeForForm(tripNotice, "recap-photos")}
        locale={locale}
      />

      {canConfigure ? (
        <RequirementsSection
          action={saveRequirementsAction.bind(null, shopSlug, tripId)}
          status={noticeForForm(tripNotice, "requirements")}
          trip={trip}
          requirement={requirement}
          siteRequirement={siteRequirement}
          siteNames={diveSites.sites.map((site) => site.name)}
          locale={locale}
        />
      ) : null}

      {/* Who's aboard is manifest accuracy (glossary) — open to all staff.
          Per-person assign/unassign (updateTripCrewAction), the same mutation
          Today's DepartureBoard uses — not a whole-set replace — so two staff
          editing crew at once can no longer clobber each other (Lens 17 task
          139). */}
      <CrewSection
        shopSlug={shopSlug}
        tripId={tripId}
        staff={staff}
        crewIds={crewIds}
        crewRoles={Object.fromEntries(tripRoleByPerson)}
        onShiftIds={onShiftIds}
        crewGapCode={crewGap.code}
        updateCrewAction={updateTripCrewAction.bind(null, shopSlug)}
        copy={{
          heading: t("trips.crew.heading"),
          description: t("trips.crew.description"),
          courseNeedsInstructor: t("trips.crew.courseNeedsInstructor"),
          overRatioWarning,
          noStaff: t("trips.crew.noCrew"),
          notAssignedYet: t("trips.crew.notAssignedYet"),
          assignLabel: t("shared.today.departureBoard.assignCrewLabel"),
          assignOption: t("shared.today.departureBoard.assignCrewOption"),
          unassignAria: t("shared.today.departureBoard.unassignAria"),
          assignFailed: t("shared.today.departureBoard.assignFailed"),
          roleAria: t("trips.crew.roleAria"),
          roleUnspecified: t("trips.crew.roleUnspecified"),
          roleOptions: {
            instructor: t("trips.crew.roleInstructor"),
            divemaster: t("trips.crew.roleDivemaster"),
            captain: t("trips.crew.roleCaptain"),
            crew: t("trips.crew.roleCrew"),
          },
          onShift: t("trips.crew.onShift"),
          notOnShift: t("trips.crew.notOnShift"),
          manageShifts: t("trips.crew.manageShifts"),
        }}
      />

      {canConfigure && series ? (
        <SeriesSection
          intervalWeeks={series.intervalWeeks}
          occurrenceCount={series.occurrenceCount}
          futureScheduledCount={series.futureScheduledCount}
          status={noticeForForm(tripNotice, "series")}
          applyAction={applySeriesDetailsAction.bind(null, shopSlug, tripId, series.id)}
          cancelAction={cancelSeriesAction.bind(null, shopSlug, tripId, series.id)}
          extendAction={extendSeriesAction.bind(null, shopSlug, tripId, series.id)}
          locale={locale}
        />
      ) : null}

      <section className="mt-12 border-t border-border pt-6">
        <FormStatus tone={lifecycleStatus?.tone} className="mb-3">
          {lifecycleStatus?.text}
        </FormStatus>
        {cancelled ? (
          <div className="flex flex-wrap items-center gap-3">
            {canConfigure ? (
              <form action={reinstateTripAction.bind(null, shopSlug, tripId)}>
                <SubmitButton
                  pendingLabel={t("trips.detail.reinstating")}
                  className={buttonClass()}
                >
                  {t("trips.detail.reinstate")}
                </SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-muted">{t("trips.detail.cancelledNotice")}</p>
            )}
            {blowoutCalled ? (
              <Link
                href={`/shop/${shopSlug}/schedule/blowout/${tripId}`}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("trips.detail.viewBlowout")}
              </Link>
            ) : null}
          </div>
        ) : (
          // A single trip's weather cancellation is the crew's go/no-go call
          // (glossary) — open to all staff. The blow-out link leads to its own
          // confirm page (ADR 20260804-blowout-cascade): cancel *and* message
          // every diver their qualifying alternatives. The quiet cancel stays
          // for the cases with nobody to message. Reinstating is config work.
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/shop/${shopSlug}/schedule/blowout/${tripId}`}
              className={buttonClass({ variant: "danger" })}
            >
              {t("trips.detail.weatherBlowout")}
            </Link>
            <p className="text-sm text-muted">{t("trips.detail.weatherBlowoutHint")}</p>
            <form
              action={cancelTripAction.bind(null, shopSlug, tripId)}
              className="flex items-center gap-3"
            >
              <SubmitButton
                pendingLabel={t("trips.detail.cancelling")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("trips.detail.cancelTrip")}
              </SubmitButton>
              <p className="text-sm text-muted">{t("trips.detail.cancelHint")}</p>
            </form>
          </div>
        )}
      </section>
    </>
  );
}
