import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { canPersonConfigureTrips } from "@/db/authz";
import { hasTripBlowout } from "@/db/blowouts";
import { getDb } from "@/db/client";
import { listDiveSites } from "@/db/dive-sites";
import { listDepartureBoardedByTrip } from "@/db/manifests";
import { countOpenTripOrders } from "@/db/orders";
import { getTripRequirements, getTripSiteRequirement, listTripReadiness } from "@/db/readiness";
import { listTripPrepDivers } from "@/db/rental-fit";
import { getShopById } from "@/db/shops";
import { crewShiftCoverage } from "@/db/staffing";
import {
  getTripCrewAssignments,
  getTripSeriesSummary,
  getTripWithBooked,
  listOffCadenceSeriesTrips,
  listStaff,
  listTripDives,
  listTripScheduleDays,
} from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { courseCrewGap, DSD_RATIO } from "@/lib/course-ratios";
import { countInWaterCrew } from "@/lib/crew-roles";
import { formatShortDate, formatTimeRangeTz, weekdayNames } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicTripPath } from "@/lib/public-routes";
import { recurrenceSummary, SERIES_HORIZON_DAYS } from "@/lib/recurrence";
import { rentalFitCompleteness } from "@/lib/rentals";
import { rosterRowIsBlocked } from "@/lib/roster-filters";
import { requireStaffSession } from "@/lib/session";
import { noticeForForm, shopPath } from "@/lib/staff-notices";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { summarizeTripDiveSites } from "@/lib/trip-dives";
import { isFull, spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { utcToWallTime } from "@/lib/zoned";
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
 * **One column at every width, deliberately.** A design review asked for an
 * `lg` two-column split — the operational spine (details, requirements, crew)
 * left, the post-trip material right — on the grounds that a 1280 viewport
 * leaves the right half empty. Declined by the owner (2026-08-14), and the
 * complaint it answered no longer holds: the two post-trip sections that made
 * the page long are `departed`-gated, so before a boat sails this page is the
 * operational spine and nothing else. A second column would then have to be
 * filled with something, which is how a page acquires content that exists to
 * occupy space. The reading measure a single ~800px column gives is also the
 * right one for the prose these sections carry. If this changes, it changes
 * because a section was added, not because the screen is wide.
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
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
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
  const cancelled = trip.status === "cancelled";
  // "Is this trip behind us?" — the same reading the recap run makes when it
  // decides whose recap to send (`sendDueRecaps`, src/db/recap.ts): the boat is
  // back once its end time has passed, and a cancelled departure never sailed
  // at all. Read through the clock, never `new Date()`, so the e2e fleet's
  // frozen instant renders this page identically every run.
  const departed = !cancelled && trip.endsAt <= nowDate();
  // The pulse — the state-of-the-boat strip that opens the page — only beats
  // for a departure that is still ahead: a cancelled or departed trip has no
  // seats to fill or blockers to clear, and the recap material takes over.
  const pulseNeeded = !cancelled && !departed;
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
    blowoutCalled,
    pulseReadiness,
    pulsePrepDivers,
    pulseBoardedByTrip,
    pulseOpenOrders,
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
    // Whether this trip's cancellation was a called blow-out — the cascade
    // record is the surface a weather morning is worked from, so the trip page
    // must always offer the way back to it (ADR 20260804-blowout-cascade).
    hasTripBlowout(db, shop.id, tripId),
    // The pulse's facts, read only while the trip is still ahead. All go
    // through the readers their destination surfaces already trust — the
    // roster's own blocked predicate, the prep list's own completeness rule,
    // and the manifest's own boarded reader — so the counts on this strip can
    // never disagree with the pages it links to, and its bar means exactly
    // what Today's does on the morning divers start boarding.
    pulseNeeded ? listTripReadiness(db, shop.id, tripId) : [],
    pulseNeeded ? listTripPrepDivers(db, shop.id, tripId) : [],
    pulseNeeded
      ? listDepartureBoardedByTrip(db, shop.id, [tripId])
      : new Map<string, Set<string>>(),
    // …and the third question a staffer asks of an upcoming boat, after "can
    // everyone board" and "can the packer pack": is anyone still owing money
    // for it. `countOpenTripOrders` asks the Orders index's own question
    // (`shopOrderWhere`, src/db/orders.ts) so this number and the filtered
    // index the fact opens can never disagree.
    pulseNeeded ? countOpenTripOrders(db, shop.id, tripId) : 0,
  ]);
  // Only ever non-empty right after staff narrowed this run's cadence, and only
  // for someone who can act on it — a second query rather than a field on the
  // summary, because it is the one thing here that costs a join and is empty
  // almost always.
  const offCadence =
    canConfigure && series ? await listOffCadenceSeriesTrips(db, shop.id, series.id) : [];
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
  // How the boat stands, in the pulse's terms: who still can't board (the
  // roster chips' own rule, src/lib/roster-filters.ts) and whose rental fit
  // the packer can't pack from yet (the prep list's own rule, src/lib/rentals.ts).
  const pulseBlocked = pulseReadiness.filter((row) => rosterRowIsBlocked(row.readiness)).length;
  const pulsePrepGaps = pulsePrepDivers.filter(
    (diver) => rentalFitCompleteness(diver.fit, shop.rentalItems).state !== "complete",
  ).length;
  const pulseBoarded = pulseBoardedByTrip.get(tripId)?.size ?? 0;
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
  // the staffing page. `null` — the shop has never scheduled a shift — means
  // the question doesn't apply, and CrewSection renders no coverage state.
  const shiftCoverage = await crewShiftCoverage(db, shop.id, trip, crewIds);
  const onShiftIds = shiftCoverage === null ? null : [...shiftCoverage];
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
    pulseBoarded > 0
      ? `${t("trips.pulse.aboard", { count: pulseBoarded })} · ${pulseSeats}`
      : pulseSeats;
  const pulseFacts: TripPulseFact[] = [
    ...(pulseBlocked > 0
      ? [
          {
            text: t("trips.pulse.blocked", { count: pulseBlocked }),
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
    ...(pulsePrepGaps > 0
      ? [
          {
            text: t("trips.pulse.prepGaps", { count: pulsePrepGaps }),
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
    ...(pulseOpenOrders > 0
      ? [
          {
            text: t("trips.pulse.awaitingPayment", { count: pulseOpenOrders }),
            href: `${shopPath(shopSlug, "orders")}?tripId=${tripId}&status=open&range=all`,
          },
        ]
      : []),
  ];

  return (
    <>
      <FlashParams params={["notice", "count", "form"]} />
      <TripPageHeader
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
              className={buttonClass({ variant: "link", size: "sm" })}
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
            {/* A real list, not a wrapped run of spans. The days used to sit in
                one `flex-wrap` row separated by nothing but a 12px gap, so a
                three-day course read as "3 meeting days · same instructors each
                day Day 1: Tue Oct 13 · 9:00 AM – 5:00 PM Day 2: …" — one
                sentence with no seams, re-flowing differently at every width.
                One line per day is what the diver's own booking page shows, and
                the two now read the same. */}
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
            {trip.course ? (
              <p className="text-sm font-medium text-primary">
                {t.rich("trips.detail.courseSession", {
                  title: trip.course.title,
                  course: (chunks) => (
                    <Link
                      href={shopPath(shopSlug, "courses", trip.course?.slug ?? "", "edit")}
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
                    {/* One key, pluralized by ICU — not two keys picked by a
                        ternary. A `length === 1 ? a : b` in the component is
                        English's plural rule hard-coded at the call site; every
                        other count on this page goes through
                        `{count, plural, …}` so a locale with a different rule
                        (or a different word order) can express it in the
                        bundle. */}
                    <span>
                      {t("trips.detail.diveSiteLabel", { count: diveSites.sites.length })}
                    </span>
                    {/* Each site keeps its own link into the library card, so a
                        two-site day is two destinations — which rules out an
                        `Intl.ListFormat` join. The separator is punctuation
                        between links, not a word to translate. */}
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
                    locale,
                    recurrenceSummary({
                      intervalWeeks: series.intervalWeeks,
                      weekdays: series.weekdayMask,
                      endsOn: series.endsOn,
                    }),
                  ),
                  count: series.scheduledCount,
                })}
              </p>
            ) : null}
          </>
        }
      />

      <TripNoticeBanner notice={pageNotice} locale={locale} />

      {pulseNeeded ? (
        <TripPulse
          booked={trip.booked}
          boarded={pulseBoarded}
          blocked={pulseBlocked}
          capacity={trip.capacity}
          caption={pulseCaption}
          captionTone={isFull(trip) ? "success" : undefined}
          facts={pulseFacts}
        />
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

      {/* Ops before content: what the trip requires and who runs it are what a
          staffer opening an upcoming departure needs next, so they follow the
          details directly — the crew's day-of prediction and the post-trip
          recap material read after them. */}
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
                href={shopPath(shopSlug, "schedule", "blowout", tripId)}
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
              href={shopPath(shopSlug, "schedule", "blowout", tripId)}
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
