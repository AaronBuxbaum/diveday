import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listDiveSites } from "@/db/dive-sites";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { getShopById } from "@/db/shops";
import {
  getTripCrewIds,
  getTripSeriesSummary,
  getTripWithBooked,
  listStaff,
  listTripDives,
} from "@/db/trips";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { recurrenceSummary } from "@/lib/recurrence";
import { requireStaffSession } from "@/lib/session";
import { capacityLabel, isFull } from "@/lib/trips";
import { utcToWallTime } from "@/lib/zoned";
import { ConditionsSection } from "./_components/ConditionsSection";
import { CrewSection } from "./_components/CrewSection";
import { DetailsSection } from "./_components/DetailsSection";
import { RequirementsSection } from "./_components/RequirementsSection";
import { TripNoticeBanner } from "./_components/TripNoticeBanner";
import {
  cancelTripAction,
  clearConditionsAction,
  reinstateTripAction,
  saveConditionsAction,
  saveCrewAction,
  saveDetails,
  saveRequirementsAction,
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
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();
  const [staff, crewIds, requirement, diveSiteList, tripDiveList] = await Promise.all([
    listStaff(db, shop.id),
    getTripCrewIds(db, tripId),
    getTripRequirements(db, shop.id, tripId),
    listDiveSites(db, shop.id),
    listTripDives(db, shop.id, tripId),
  ]);
  const siteRequirement = await getTripSiteRequirement(db, shop.id, tripId);
  const series = await getTripSeriesSummary(db, shop.id, tripId);
  const startWall = utcToWallTime(trip.startsAt, shop.timezone);
  const endWall = utcToWallTime(trip.endsAt, shop.timezone);
  const cancelled = trip.status === "cancelled";
  const hasCourseInstructor = Boolean(
    trip.course &&
      staff.some(
        (entry) => crewIds.includes(entry.person.id) && entry.roles.includes("instructor"),
      ),
  );

  return (
    <>
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow="Trips"
        title={trip.title}
        meta={
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              {cancelled ? (
                <Badge tone="danger">Cancelled</Badge>
              ) : (
                <Badge tone={isFull(trip) ? "neutral" : "primary"} tabularNums>
                  {capacityLabel(trip)}
                </Badge>
              )}
              <span className="text-muted">
                {formatShortDate(trip.startsAt, "en-US", shop.timezone)} ·{" "}
                {formatTimeRangeTz(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
              </span>
            </div>
            {trip.course ? (
              <p className="text-sm font-medium text-primary">
                Course session · {trip.course.title}
              </p>
            ) : null}
            {series ? (
              <p className="text-sm text-muted">
                Part of a repeating series ·{" "}
                {recurrenceSummary({
                  frequency: "weekly",
                  intervalWeeks: series.intervalWeeks,
                  occurrenceCount: series.occurrenceCount,
                })}
                . Changes here apply to this date only; {series.scheduledCount} still on the
                schedule.
              </p>
            ) : null}
          </div>
        }
      />

      <TripNoticeBanner notice={notice} />

      <DetailsSection
        action={saveDetails.bind(null, shopSlug, tripId)}
        trip={trip}
        diveSiteList={diveSiteList}
        tripDiveList={tripDiveList}
        startWall={startWall}
        endWall={endWall}
      />

      <ConditionsSection
        saveAction={saveConditionsAction.bind(null, shopSlug, tripId)}
        clearAction={clearConditionsAction.bind(null, shopSlug, tripId)}
        trip={trip}
      />

      <RequirementsSection
        action={saveRequirementsAction.bind(null, shopSlug, tripId)}
        trip={trip}
        requirement={requirement}
        siteRequirement={siteRequirement}
      />

      <CrewSection
        action={saveCrewAction.bind(null, shopSlug, tripId)}
        trip={trip}
        staff={staff}
        crewIds={crewIds}
        hasCourseInstructor={hasCourseInstructor}
      />

      <section className="mt-12 border-t border-border pt-6">
        {cancelled ? (
          <form action={reinstateTripAction.bind(null, shopSlug, tripId)}>
            <SubmitButton pendingLabel="Reinstating…" className={buttonClass()}>
              Reinstate trip
            </SubmitButton>
          </form>
        ) : (
          <form
            action={cancelTripAction.bind(null, shopSlug, tripId)}
            className="flex items-center gap-3"
          >
            <SubmitButton pendingLabel="Cancelling…" className={buttonClass({ variant: "danger" })}>
              Cancel trip
            </SubmitButton>
            <p className="text-sm text-muted">
              Takes it off the public schedule. You can reinstate it any time.
            </p>
          </form>
        )}
      </section>
    </>
  );
}
