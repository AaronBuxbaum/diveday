import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { listDiveSites } from "@/db/dive-sites";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { getShopById } from "@/db/shops";
import { crewShiftCoverage } from "@/db/staffing";
import {
  getTripCrewIds,
  getTripSeriesSummary,
  getTripWithBooked,
  listStaff,
  listTripDives,
  listTripScheduleDays,
} from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { courseCrewGap } from "@/lib/course-ratios";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { recurrenceSummary } from "@/lib/recurrence";
import { requireStaffSession } from "@/lib/session";
import { capacityLabel, isFull } from "@/lib/trips";
import { utcToWallTime } from "@/lib/zoned";
import { ConditionsSection } from "./_components/ConditionsSection";
import { CopyLinkButton } from "./_components/CopyLinkButton";
import { CrewSection } from "./_components/CrewSection";
import { DetailsSection } from "./_components/DetailsSection";
import { RecapNoteSection } from "./_components/RecapNoteSection";
import { RequirementsSection } from "./_components/RequirementsSection";
import { recurrenceSummaryText, SeriesSection } from "./_components/SeriesSection";
import { TripNoticeBanner } from "./_components/TripNoticeBanner";
import {
  applySeriesDetailsAction,
  cancelSeriesAction,
  cancelTripAction,
  clearConditionsAction,
  extendSeriesAction,
  reinstateTripAction,
  saveConditionsAction,
  saveDetails,
  saveRecapShoutoutAction,
  saveRequirementsAction,
  updateTripCrewAction,
} from "./actions";

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
  searchParams: Promise<{ notice?: string; count?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { notice, count } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();
  const [
    staff,
    crewIds,
    requirement,
    diveSiteList,
    tripDiveList,
    siteRequirement,
    series,
    scheduleDays,
    canConfigure,
  ] = await Promise.all([
    listStaff(db, shop.id),
    getTripCrewIds(db, shop.id, tripId),
    getTripRequirements(db, shop.id, tripId),
    listDiveSites(db, shop.id),
    listTripDives(db, shop.id, tripId),
    getTripSiteRequirement(db, shop.id, tripId),
    getTripSeriesSummary(db, shop.id, tripId),
    listTripScheduleDays(db, shop.id, tripId),
    canPersonConfigureTrips(db, shop.id, session.user.personId),
  ]);
  const startWall = utcToWallTime(trip.startsAt, shop.timezone);
  const endWall = utcToWallTime(trip.endsAt, shop.timezone);
  const cancelled = trip.status === "cancelled";
  const assignedCrew = staff.filter((entry) => crewIds.includes(entry.person.id));
  // Staff can freely change crew after divers are already booked (H-14 lets
  // any staff member do this — it's day-of operating work). `courseCrewGap`
  // (src/lib/course-ratios.ts) is the one computation of "does this course
  // session have enough crew", also consumed by the staffing coverage list
  // and the Today queue (docs/product/assessments/ux-personas-20260730.md,
  // Lens 17 task 151) — over_ratio is the visible nudge to fix an entry-level
  // (PADI, ungated) session before sailing, never a retroactive block on the
  // bookings already taken.
  const crewGap = courseCrewGap({
    course: trip.course,
    instructorCount: assignedCrew.filter((entry) => entry.roles.includes("instructor")).length,
    assistantCount: assignedCrew.filter(
      (entry) => entry.roles.includes("divemaster") && !entry.roles.includes("instructor"),
    ).length,
    booked: trip.booked,
  });
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

  return (
    <>
      <FlashParams params={["notice", "count"]} />
      <ShopPageHeader
        eyebrow={t("trips.detail.eyebrow")}
        title={trip.title}
        actions={
          <>
            <Link
              href={`/shop/${shopSlug}/schedule/${tripId}`}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("trips.detail.viewBookingPage")}
            </Link>
            <CopyLinkButton
              path={`/shop/${shopSlug}/schedule/${tripId}`}
              label={t("trips.detail.copyBookingLink")}
              copiedLabel={t("trips.detail.linkCopied")}
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
            {trip.diveSite ? (
              <p className="text-sm text-muted">
                {t("trips.detail.diveSiteLabel")}{" "}
                <Link
                  href={`/shop/${shopSlug}/dive-sites/${trip.diveSite.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {trip.diveSite.name}
                </Link>
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

      <TripNoticeBanner notice={notice} count={count} locale={locale} />

      {canConfigure ? null : (
        <div className="mt-6">
          <ShopNotice tone="neutral" role="status">
            {t("trips.detail.viewOnlyNotice")}
          </ShopNotice>
        </div>
      )}

      {canConfigure ? (
        <DetailsSection
          action={saveDetails.bind(null, shopSlug, tripId)}
          trip={trip}
          diveSiteList={diveSiteList}
          tripDiveList={tripDiveList}
          startWall={startWall}
          endWall={endWall}
          locale={locale}
        />
      ) : null}

      {/* Conditions are crew-entered (glossary) — open to all staff. */}
      <ConditionsSection
        saveAction={saveConditionsAction.bind(null, shopSlug, tripId)}
        clearAction={clearConditionsAction.bind(null, shopSlug, tripId)}
        trip={trip}
        locale={locale}
      />

      <RecapNoteSection
        action={saveRecapShoutoutAction.bind(null, shopSlug, tripId)}
        shoutout={trip.recapShoutout}
        locale={locale}
      />

      {canConfigure ? (
        <RequirementsSection
          action={saveRequirementsAction.bind(null, shopSlug, tripId)}
          trip={trip}
          requirement={requirement}
          siteRequirement={siteRequirement}
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
        onShiftIds={onShiftIds}
        crewGapCode={crewGap.code}
        updateCrewAction={updateTripCrewAction.bind(null, shopSlug)}
        copy={{
          heading: t("trips.crew.heading"),
          description: t("trips.crew.description"),
          courseNeedsInstructor: t("trips.crew.courseNeedsInstructor"),
          overRatioWarning:
            crewGap.code === "over_ratio"
              ? t("trips.detail.overRatioWarning", {
                  booked: crewGap.booked,
                  cap: crewGap.capacity,
                })
              : null,
          noStaff: t("trips.crew.noCrew"),
          notAssignedYet: t("trips.crew.notAssignedYet"),
          assignLabel: t("shared.today.departureBoard.assignCrewLabel"),
          assignOption: t("shared.today.departureBoard.assignCrewOption"),
          unassignAria: t("shared.today.departureBoard.unassignAria"),
          assignFailed: t("shared.today.departureBoard.assignFailed"),
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
          applyAction={applySeriesDetailsAction.bind(null, shopSlug, tripId, series.id)}
          cancelAction={cancelSeriesAction.bind(null, shopSlug, tripId, series.id)}
          extendAction={extendSeriesAction.bind(null, shopSlug, tripId, series.id)}
          locale={locale}
        />
      ) : null}

      <section className="mt-12 border-t border-border pt-6">
        {cancelled ? (
          canConfigure ? (
            <form action={reinstateTripAction.bind(null, shopSlug, tripId)}>
              <SubmitButton pendingLabel={t("trips.detail.reinstating")} className={buttonClass()}>
                {t("trips.detail.reinstate")}
              </SubmitButton>
            </form>
          ) : (
            <p className="text-sm text-muted">{t("trips.detail.cancelledNotice")}</p>
          )
        ) : (
          // A single trip's weather cancellation is the crew's go/no-go call
          // (glossary) — open to all staff. Reinstating it is config work.
          <form
            action={cancelTripAction.bind(null, shopSlug, tripId)}
            className="flex items-center gap-3"
          >
            <SubmitButton
              pendingLabel={t("trips.detail.cancelling")}
              className={buttonClass({ variant: "danger" })}
            >
              {t("trips.detail.cancelTrip")}
            </SubmitButton>
            <p className="text-sm text-muted">{t("trips.detail.cancelHint")}</p>
          </form>
        )}
      </section>
    </>
  );
}
