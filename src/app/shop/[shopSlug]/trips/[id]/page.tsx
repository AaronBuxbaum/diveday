import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { listBoats } from "@/db/boats";
import { getTripOverview } from "@/db/trips-overview";
import { languageNameIn } from "@/i18n/language-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { DSD_RATIO } from "@/lib/course-ratios";
import { formatShortDate, formatTimeRangeTz, weekdayNames } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { fetchAutomatedMarineForecast, shouldShowAutomatedForecast } from "@/lib/marine-forecast";
import { toShopCurrency } from "@/lib/money";
import { publicTripPath } from "@/lib/public-routes";
import { recurrenceSummary, SERIES_HORIZON_DAYS } from "@/lib/recurrence";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeForForm, shopPath } from "@/lib/staff-notices";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { isFull, spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { ConditionsSection } from "./_components/ConditionsSection";
import { CopyLinkButton } from "./_components/CopyLinkButton";
import { CrewSection } from "./_components/CrewSection";
import { DetailsSection } from "./_components/DetailsSection";
import { MinimumSeatsBand } from "./_components/MinimumSeatsBand";
import { PrintTripBundleButton } from "./_components/PrintTripBundleButton";
import { RequirementsSection } from "./_components/RequirementsSection";
import { recurrenceSummaryText, SeriesSection } from "./_components/SeriesSection";
import { resolveTripNotice, TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripCapacityBadge, TripPageHeader } from "./_components/TripPageHeader";
import { TripPulse, type TripPulseFact } from "./_components/TripPulse";
import {
  applySeriesDetailsAction,
  cancelOffCadenceSeriesAction,
  cancelSeriesAction,
  cancelTripAction,
  clearConditionsAction,
  recordTripPrintPdfAction,
  reinstateTripAction,
  saveConditionsAction,
  saveDetails,
  saveRequirementsAction,
  setSeriesRepeatAction,
  updateSeriesCadenceAction,
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
 *
 * The composition is masthead → pulse → the section cards, one column at
 * every width. A design review once asked for an `lg` two-column split;
 * declined by the owner (2026-08-14) — a second column would have to be
 * filled with something, which is how a page acquires content that exists to
 * occupy space. If this changes, it changes because a section was added, not
 * because the screen is wide.
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
  const [{ shopSlug, id: tripId }, { notice, count, form, gate }] = await Promise.all([
    params,
    searchParams,
  ]);
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { session, db, shop } = await requireShopSurface(shopSlug);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  // Locale and the trip row both depend on `shop` but not on each other.
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const overview = await getTripOverview(db, shop, tripId, session.user.personId);
  // The fleet, for the Details form's hull select. Live hulls only: this is a
  // picker for what the departure will sail on, not a record of what it did
  // (`listBoatsForHistory` is the other one).
  const shopBoats = shop.hasBoatDiving ? await listBoats(db, shop.id) : [];
  if (!overview) notFound();
  const {
    trip,
    cancelled,
    pulseNeeded,
    staff,
    requirement,
    diveSiteList,
    tripDiveList,
    siteRequirement,
    series,
    scheduleDays,
    canConfigure,
    blowoutCalled,
    offCadence,
    diveSites,
    startWall,
    endWall,
    pulse,
    crew,
  } = overview;
  const { crewIds, tripRoleByPerson, crewGap, ratioGap, languageGap, onShiftIds } = crew;
  // Same tone as underTargetNote below: informs, refuses nothing (issue
  // #708). Each missing language is named in the reader's own locale
  // (`languageNameIn`), matching the team settings form's convention —
  // unlike the diver-facing badge, which uses each language's own endonym.
  const languageGapNote =
    languageGap.code === "none"
      ? null
      : t("trips.crew.languageGap", {
          languages: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
            languageGap.missing.map((code) => languageNameIn(code, locale) ?? code),
          ),
        });
  const underTargetNote =
    ratioGap.code === "none"
      ? null
      : t("trips.crew.underTarget", {
          divers: ratioGap.divers,
          divemasters: ratioGap.divemasterCount,
          ratio: shop.diversPerDivemaster,
          // The total the target wants, not the shortfall: "wants 1 more" than
          // none reads as arithmetic about nothing when the boat has no
          // divemaster at all, which is the case that matters most.
          needed: ratioGap.needed,
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

  // One resolution, handed to the section it belongs to. Whatever no rendered
  // section claims — a page-level permission refusal, or a section this
  // staffer's role means we never rendered — falls through to the banner.
  const tripNotice = resolveTripNotice({ notice, count, form, gate, tripId, locale });
  const sectionsOnPage = new Set([
    ...(canConfigure ? ["details", "requirements"] : []),
    "conditions",
    "lifecycle",
    ...(canConfigure && series ? ["series"] : []),
  ]);
  const lifecycleStatus = noticeForForm(tripNotice, "lifecycle");
  const pageNotice = tripNotice && sectionsOnPage.has(tripNotice.form) ? undefined : tripNotice;

  // The pulse in words: the caption carries every number the bar draws, and
  // each fact is a whole sentence linking to the surface that fixes it. A fact
  // at zero contributes nothing — "none blocked" is not a status (principle 9).
  // "Aboard" joins the caption only once boarding has actually begun, with the
  // separator the caption's own key already uses between its clauses.
  const pulseSeats = isFull(trip)
    ? t("trips.pulse.seatsFull", { capacity: trip.capacity })
    : t("trips.pulse.seats", {
        booked: trip.booked,
        capacity: trip.capacity,
        open: spotsRemaining(trip),
      });
  const pulseCaption =
    pulse.boarded > 0
      ? `${t("trips.pulse.aboard", { count: pulse.boarded })} · ${pulseSeats}`
      : pulseSeats;
  const pulseFacts: TripPulseFact[] = [
    ...(pulse.blocked > 0
      ? [
          {
            text: t("trips.pulse.blocked", { count: pulse.blocked }),
            href: `${shopPath(shopSlug, "trips", tripId, "guests")}?rf=blocked#roster`,
            tone: "danger" as const,
          },
        ]
      : []),
    // A course session whose crew can't cover it is a can-this-boat-sail fact
    // in the pulse's exact register — until it surfaces here, the strip's
    // quiet reads as an all clear the Crew panel three screens down would
    // contradict. The panel keeps the full sentence; this is the door to it.
    ...(crewGap.code === "no_instructor"
      ? [
          {
            text: t("trips.pulse.needsInstructor"),
            href: "#crew",
            tone: "danger" as const,
          },
        ]
      : []),
    ...(crewGap.code === "over_ratio"
      ? [
          {
            text: t("trips.pulse.overRatio"),
            href: "#crew",
            tone: "danger" as const,
          },
        ]
      : []),
    ...(pulse.prepGaps > 0
      ? [
          {
            text: t("trips.pulse.prepGaps", { count: pulse.prepGaps }),
            href: shopPath(shopSlug, "trips", tripId, "prep"),
          },
        ]
      : []),
    // Money owed is work, not a boarding hazard — so it reads in the pulse's
    // neutral ink, below the facts that hold the boat up, and it is the one
    // fact here whose fix lives off the trip entirely. `range=all` because the
    // count is unwindowed: a seat sold months ahead was invoiced months ago,
    // and the index's default 90-day window would open on fewer orders than
    // the fact just promised.
    ...(pulse.openOrders > 0
      ? [
          {
            text: t("trips.pulse.awaitingPayment", { count: pulse.openOrders }),
            href: `${shopPath(shopSlug, "orders")}?tripId=${tripId}&status=open&range=all`,
          },
        ]
      : []),
  ];

  // The one quiet line under the date that says what kind of departure this
  // is: where it dives, whether it is a course session, whether it repeats.
  // Built as keyed segments so the separators render only between facts that
  // exist.
  const identityFacts = [
    diveSites.sites.length > 0 ? (
      <span key="sites" className="flex flex-wrap items-center gap-x-2">
        {/* One key, pluralized by ICU — not two keys picked by a ternary, so a
            locale with a different plural rule can express it in the bundle. */}
        <span>{t("trips.detail.diveSiteLabel", { count: diveSites.sites.length })}</span>
        {/* Each site keeps its own link into the library card, so a two-site
            day is two destinations — which rules out an `Intl.ListFormat`
            join. The separator is punctuation between links, not a word to
            translate. */}
        {diveSites.sites.map((site, index) => (
          <span key={site.id} className="flex items-center gap-x-2">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <Link
              href={shopPath(shopSlug, "dive-sites", site.id)}
              className="font-medium text-primary hover:underline"
            >
              {site.name}
            </Link>
          </span>
        ))}
      </span>
    ) : null,
    diveSites.undecidedDives > 0 ? (
      <span key="undecided">
        {t("trips.detail.divesWithoutSite", { count: diveSites.undecidedDives })}
      </span>
    ) : null,
    trip.course ? (
      <span key="course">
        {t.rich("trips.detail.courseSession", {
          title: trip.course.title,
          course: (chunks) => (
            <Link
              href={shopPath(shopSlug, "courses", trip.course?.slug ?? "", "edit")}
              className="font-medium text-primary hover:underline"
            >
              {chunks}
            </Link>
          ),
        })}
      </span>
    ) : null,
    series ? (
      <span key="series">
        {t("trips.detail.seriesPart", {
          summary: recurrenceSummaryText(
            t,
            locale,
            recurrenceSummary({
              intervalWeeks: series.intervalWeeks,
              weekdays: series.weekdayMask,
              endsOn: series.endsOn,
            }),
          ),
          count: series.scheduledCount,
        })}
      </span>
    ) : null,
  ].filter((fact): fact is React.ReactElement => fact !== null);

  const siteWithForecast = tripDiveList.find(
    ({ diveSite }) =>
      diveSite && diveSite.forecastLatitude !== null && diveSite.forecastLongitude !== null,
  )?.diveSite;
  const forecastPoint =
    siteWithForecast &&
    siteWithForecast.forecastLatitude !== null &&
    siteWithForecast.forecastLongitude !== null
      ? {
          latitude: siteWithForecast.forecastLatitude,
          longitude: siteWithForecast.forecastLongitude,
        }
      : null;
  const automatedForecast =
    forecastPoint && shouldShowAutomatedForecast(trip.startsAt)
      ? await fetchAutomatedMarineForecast(forecastPoint, trip.startsAt)
      : null;

  return (
    <>
      <FlashParams params={["notice", "count", "form"]} />
      <TripPageHeader
        boardHref={shopPath(shopSlug, "schedule", "board")}
        backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
        trip={trip}
        locale={locale}
        timeZone={shop.timezone}
        badge={
          // While the pulse beats it owns the seat numbers — a "3 spots left"
          // pill above a strip reading "9 of 12 booked · 3 seats open" would
          // state the same fact twice (principle 9). Cancelled is the one
          // state the badge still announces; a departed trip gets neither —
          // "3 spots left" on a boat already home is a dead fact formatted as
          // a live status, and it reads as sellable seats.
          cancelled ? (
            <TripCapacityBadge
              trip={trip}
              cancelledLabel={t("trips.detail.cancelledBadge")}
              t={t}
            />
          ) : undefined
        }
        actions={
          <>
            <CopyLinkButton
              path={publicTripPath(shopSlug, tripId)}
              label={t("trips.detail.copyBookingLink")}
              copiedLabel={t("trips.detail.linkCopied")}
              failedLabel={t("trips.detail.linkCopyFailed")}
            />
            <Link
              href={publicTripPath(shopSlug, tripId)}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              {t("trips.detail.viewBookingPage")}
            </Link>
            <PrintTripBundleButton
              href={shopPath(shopSlug, "trips", tripId, "print")}
              label={t("shared.printButton.label")}
              popupBlockedLabel={t("shared.printButton.popupBlocked")}
              recordAction={recordTripPrintPdfAction.bind(null, shopSlug, tripId)}
            />
          </>
        }
        extraMeta={
          <>
            {/* Read off the dives, never `trip.diveSite` — that column is only
                dive one's site copied onto the trip row, so it named one site
                for a two-site day and named none at all when the tank without
                a site was the first one. */}
            {identityFacts.length > 0 ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                {identityFacts.map((fact, index) => (
                  <span key={fact.key} className="flex flex-wrap items-center gap-x-2">
                    {index > 0 ? <span aria-hidden="true">·</span> : null}
                    {fact}
                  </span>
                ))}
              </p>
            ) : null}
            {/* A real list, not a wrapped run of spans. The days used to sit in
                one `flex-wrap` row separated by nothing but a 12px gap, so a
                three-day course read as one sentence with no seams. One line
                per day is what the diver's own booking page shows, and the two
                now read the same. */}
            {scheduleDays.length > 1 ? (
              <div className="text-sm text-muted">
                <p>{t("trips.detail.meetingDaysSummary", { count: scheduleDays.length })}</p>
                <ol className="mt-1 space-y-0.5">
                  {scheduleDays.map((day) => (
                    <li key={day.id}>
                      {t("trips.detail.dayLabel", {
                        number: day.dayNumber,
                        date: formatShortDate(day.startsAt, locale, shop.timezone),
                        timeRange: formatTimeRangeTz(
                          day.startsAt,
                          day.endsAt,
                          locale,
                          shop.timezone,
                        ),
                      })}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </>
        }
      />

      <TripNoticeBanner notice={pageNotice} locale={locale} />

      {pulseNeeded ? (
        <TripPulse
          booked={trip.booked}
          boarded={pulse.boarded}
          blocked={pulse.blocked}
          capacity={trip.capacity}
          caption={pulseCaption}
          // The success ink is this page's one earned moment (principle 3),
          // and a full boat where half the roster still can't board hasn't
          // earned it — green above a strip of danger cells reads as the page
          // contradicting itself. The words say "Full boat" either way; the
          // celebration waits until the boat is actually clear.
          captionTone={
            isFull(trip) && pulse.blocked === 0 && crewGap.code === "none" ? "success" : undefined
          }
          facts={pulseFacts}
        />
      ) : null}

      {/* The pulse's slot, kept for a cancelled departure: the strip taught
          the eye that "the state of this boat, and what to do about it" lives
          here, so Reinstate must not sit below four cards of forms as the last
          element on the page (design review, 2026-08-21). The masthead badge
          already says Cancelled — this band carries only the outcome of the
          last lifecycle action and the ways back: reinstate for those who can,
          the blow-out record when one was called. When neither applies and
          there is nothing to report, it renders nothing, and the badge alone
          says everything a viewer without the rights can act on. */}
      {cancelled && (canConfigure || blowoutCalled || lifecycleStatus) ? (
        <section className="mt-8 rounded-2xl border border-danger/40 bg-danger/10 p-5">
          <FormStatus tone={lifecycleStatus?.tone} className="mb-3">
            {lifecycleStatus?.text}
          </FormStatus>
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
            ) : null}
            {blowoutCalled ? (
              <Link
                href={shopPath(shopSlug, "schedule", "blowout", tripId)}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("trips.detail.viewBlowout")}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Under the pulse, and deliberately not one of its facts. The pulse
          answers "how does this boat stand" in numbers a staffer reads and
          moves on from; this answers "something is about to happen to this
          departure" — it needs the deadline and the way to overrule it, which
          is two sentences a one-line fact cannot carry. Above the role gate
          below it, because a departure that will cancel itself tonight is news
          for whoever is looking at it, not only for whoever can edit it (ADR
          20260813-minimum-head-count-departures). Renders nothing on a trip
          with no minimum, or one that has met it — so on the great majority of
          departures the pulse is still the only thing between the header and
          Details.

          Gated on `pulseNeeded` for the same reason the pulse is: the band
          classifies the *policy*, not the departure's lifecycle, so a cancelled
          trip that never made its numbers would go on announcing that DiveDay
          is about to cancel it — about a trip that is already off the board. */}
      {pulseNeeded ? (
        <MinimumSeatsBand
          trip={trip}
          booked={trip.booked}
          locale={locale}
          timeZone={shop.timezone}
          t={t}
        />
      ) : null}

      {/* No "you're viewing this trip" notice for staff without configure
          rights. The editable sections simply aren't rendered, which is the
          same thing said without a paragraph explaining the role model to
          someone who cannot change it (ADR 20260724-role-gated-surfaces-hide-
          not-explain). */}

      {/* The page owns the rhythm between its section cards; no card carries a
          margin of its own (see SectionCard). */}
      <div className="mt-10 space-y-6">
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
            warnNoPrice={!cancelled}
            boats={shopBoats.map((boat) => ({ id: boat.id, name: boat.name }))}
            hasBoatDiving={shop.hasBoatDiving}
            hasShoreDiving={shop.hasShoreDiving}
            hasPoolDiving={shop.hasPoolDiving}
          />
        ) : null}

        {/* Ops before content: what the trip requires and who runs it are what a
          staffer opening an upcoming departure needs next, so they follow the
          details directly — the crew's day-of prediction reads after them. */}
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
          // A cancelled departure isn't sailing, so its crew panel drops the
          // live-trip nudges — the ratio gates, the shop's target, and the
          // shift-coverage badges are all about a boat that will leave.
          onShiftIds={cancelled ? null : onShiftIds}
          crewGapCode={cancelled ? "none" : crewGap.code}
          updateCrewAction={updateTripCrewAction.bind(null, shopSlug)}
          copy={{
            heading: t("trips.crew.heading"),
            courseNeedsInstructor: t("trips.crew.courseNeedsInstructor"),
            overRatioWarning,
            underTargetNote: cancelled ? null : underTargetNote,
            languageGapNote: cancelled ? null : languageGapNote,
            noStaff: t("trips.crew.noCrew"),
            notAssignedYet: t("trips.crew.notAssignedYet"),
            assignLabel: t("shared.today.departureBoard.assignCrewLabel"),
            assignOption: t("shared.today.departureBoard.assignCrewOption"),
            unassignAria: t.raw("shared.today.departureBoard.unassignAria"),
            assignFailed: t("shared.today.departureBoard.assignFailed"),
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
            manageShifts: t("trips.crew.manageShifts"),
          }}
        />

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
          automatedForecast={automatedForecast}
        />

        {canConfigure && series ? (
          <SeriesSection
            intervalWeeks={series.intervalWeeks}
            weekdays={series.weekdayMask}
            endsOn={series.endsOn}
            anchorDate={series.anchorDate}
            futureScheduledCount={series.futureScheduledCount}
            horizonDays={SERIES_HORIZON_DAYS}
            offCadence={offCadence.map((date) => ({
              id: date.id,
              title: date.title,
              // Formatted here, where the request locale and the shop's zone both
              // are — the panel is handed words, never instants.
              label: formatShortDate(date.startsAt, locale, shop.timezone),
              booked: date.booked,
            }))}
            weekdayNames={weekdayNames(locale)}
            status={noticeForForm(tripNotice, "series")}
            applyAction={applySeriesDetailsAction.bind(null, shopSlug, tripId, series.id)}
            cancelAction={cancelSeriesAction.bind(null, shopSlug, tripId, series.id)}
            repeatAction={setSeriesRepeatAction.bind(null, shopSlug, tripId, series.id)}
            cadenceAction={updateSeriesCadenceAction.bind(null, shopSlug, tripId, series.id)}
            cancelOffCadenceAction={cancelOffCadenceSeriesAction.bind(
              null,
              shopSlug,
              tripId,
              series.id,
            )}
            locale={locale}
          />
        ) : null}
      </div>

      {/* The destructive tail, for a departure that is still on the board —
          a cancelled one carries its way back in the band up in the pulse's
          slot instead, and repeating it down here would be the same door
          twice. A single trip's weather cancellation is the crew's go/no-go
          call (glossary) — open to all staff. The blow-out link leads to its
          own confirm page (ADR 20260804-blowout-cascade): cancel *and*
          message every diver their qualifying alternatives. The quiet cancel
          stays for the cases with nobody to message. Each action sits on its
          own line with its consequence beside it — one gesture per row reads
          calmer than four controls sharing one wrapped line. */}
      {cancelled ? null : (
        <section className="mt-12 border-t border-border pt-8">
          <FormStatus tone={lifecycleStatus?.tone} className="mb-4">
            {lifecycleStatus?.text}
          </FormStatus>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link
                href={shopPath(shopSlug, "schedule", "blowout", tripId)}
                className={buttonClass({ variant: "danger" })}
              >
                {t("trips.detail.weatherBlowout")}
              </Link>
              <p className="text-sm text-muted">{t("trips.detail.weatherBlowoutHint")}</p>
            </div>
            <form
              action={cancelTripAction.bind(null, shopSlug, tripId)}
              className="flex flex-wrap items-center gap-x-3 gap-y-1"
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
        </section>
      )}
    </>
  );
}
