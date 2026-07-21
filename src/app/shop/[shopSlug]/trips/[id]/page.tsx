import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listDiveSites } from "@/db/dive-sites";
import { getTripRequirements, getTripSiteRequirement, listTripReadiness } from "@/db/readiness";
import { listTripPrepDivers } from "@/db/rental-fit";
import { getShopById } from "@/db/shops";
import {
  getTripCrewIds,
  getTripRoster,
  getTripSeriesSummary,
  getTripWaitlist,
  getTripWithBooked,
  listStaff,
  listTripDives,
} from "@/db/trips";
import { listTripWaiverStatuses } from "@/db/waivers";
import { nitroxTanksApproved } from "@/lib/dive-prep";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { recurrenceSummary } from "@/lib/recurrence";
import { requireStaffSession } from "@/lib/session";
import { capacityLabel, isFull } from "@/lib/trips";
import { utcToWallTime } from "@/lib/zoned";
import { AddDiverSection } from "./_components/AddDiverSection";
import { ConditionsSection } from "./_components/ConditionsSection";
import { CrewSection } from "./_components/CrewSection";
import { DetailsSection } from "./_components/DetailsSection";
import { RequirementsSection } from "./_components/RequirementsSection";
import { RosterSection } from "./_components/RosterSection";
import { TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripSubNav } from "./_components/TripSubNav";
import { WaitlistSection } from "./_components/WaitlistSection";
import {
  addBookingAction,
  addToWaitlistAction,
  cancelTripAction,
  clearConditionsAction,
  inviteWaitlistAction,
  issueWaiverAction,
  markPaymentAction,
  reinstateTripAction,
  removeBookingAction,
  saveConditionsAction,
  saveCrewAction,
  saveDetails,
  saveRequirementsAction,
  undoRemoveBookingAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Manage trip — DiveDay",
};

export default async function ManageTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string; bid?: string; waiver?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { notice, bid, waiver } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();
  const [
    staff,
    crewIds,
    roster,
    waiverRows,
    requirement,
    readinessRows,
    prepDivers,
    diveSiteList,
    tripDiveList,
    waitlist,
  ] = await Promise.all([
    listStaff(db, shop.id),
    getTripCrewIds(db, tripId),
    getTripRoster(db, tripId),
    listTripWaiverStatuses(db, shop.id, tripId),
    getTripRequirements(db, shop.id, tripId),
    listTripReadiness(db, shop.id, tripId),
    listTripPrepDivers(db, shop.id, tripId),
    listDiveSites(db, shop.id),
    listTripDives(db, shop.id, tripId),
    getTripWaitlist(db, tripId),
  ]);
  const siteRequirement = await getTripSiteRequirement(db, shop.id, tripId);
  const series = await getTripSeriesSummary(db, shop.id, tripId);
  const undoBookingId = notice === "booking-removed" ? bid : undefined;
  const startWall = utcToWallTime(trip.startsAt, shop.timezone);
  const endWall = utcToWallTime(trip.endsAt, shop.timezone);
  const cancelled = trip.status === "cancelled";
  const hasCourseInstructor = Boolean(
    trip.course &&
      staff.some(
        (entry) => crewIds.includes(entry.person.id) && entry.roles.includes("instructor"),
      ),
  );
  const rentalFitByBooking = new Map(prepDivers.map((row) => [row.bookingId, row.fit] as const));
  const nitroxByBooking = new Map(
    prepDivers
      .filter((row) => row.wantsNitrox)
      .map(
        (row) => [row.bookingId, { requested: true, approved: nitroxTanksApproved(row) }] as const,
      ),
  );
  // The roster is the spine of the diver section; waiver and readiness detail
  // hang off it by booking id so each diver renders as one consolidated card.
  const waiverByBooking = new Map(waiverRows.map((row) => [row.booking.id, row] as const));
  const readinessByBooking = new Map(readinessRows.map((row) => [row.booking.id, row] as const));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <FlashParams params={["notice", "bid", "waiver"]} />
      <header className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{trip.title}</h1>
        {cancelled ? (
          <span className="rounded-full bg-danger/10 px-3 py-1 text-sm font-medium text-danger">
            Cancelled
          </span>
        ) : (
          <span
            className={
              isFull(trip)
                ? "rounded-full border border-border bg-surface-sunken px-3 py-1 text-sm font-medium text-muted"
                : "rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary tabular-nums"
            }
          >
            {capacityLabel(trip)}
          </span>
        )}
      </header>
      <p className="mt-1 text-muted">
        {formatShortDate(trip.startsAt, "en-US", shop.timezone)} ·{" "}
        {formatTimeRangeTz(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
      </p>
      {trip.course ? (
        <p className="mt-2 text-sm font-medium text-primary">
          Course session · {trip.course.title}
        </p>
      ) : null}
      {series ? (
        <p className="mt-2 text-sm text-muted">
          Part of a repeating series ·{" "}
          {recurrenceSummary({
            frequency: "weekly",
            intervalWeeks: series.intervalWeeks,
            occurrenceCount: series.occurrenceCount,
          })}
          . Changes here apply to this date only; {series.scheduledCount} still on the schedule.
        </p>
      ) : null}

      <TripSubNav shopSlug={shopSlug} tripId={tripId} current="overview" className="mt-5" />

      <TripNoticeBanner
        notice={notice}
        undoBookingId={undoBookingId}
        undoAction={undoRemoveBookingAction.bind(null, shopSlug, tripId)}
      />

      {notice === "waiver-link" && waiver ? (
        <section className="rise-in mt-6 rounded-lg border border-accent/40 bg-accent/10 p-5">
          <h2 className="font-semibold">Private waiver link ready</h2>
          <p className="mt-1 text-sm text-muted">
            Share this link with the diver. It expires in seven days and is replaced if you issue a
            new one.
          </p>
          <Link href={`/waivers/${waiver}`} className={buttonClass({ className: "mt-3" })}>
            Open waiver link
          </Link>
        </section>
      ) : null}

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

      <WaitlistSection
        waitlist={waitlist}
        shopSlug={shopSlug}
        tripId={tripId}
        shopName={shop.name}
        tripTitle={trip.title}
        tripWhen={formatShortDate(trip.startsAt, "en-US", shop.timezone)}
        inviteAction={inviteWaitlistAction.bind(null, shopSlug, tripId)}
      />

      {cancelled ? null : (
        <AddDiverSection
          full={isFull(trip)}
          addBookingAction={addBookingAction.bind(null, shopSlug, tripId)}
          addToWaitlistAction={addToWaitlistAction.bind(null, shopSlug, tripId)}
        />
      )}

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

      <RosterSection
        shopSlug={shopSlug}
        shopTimezone={shop.timezone}
        tripId={tripId}
        booked={trip.booked}
        capacity={trip.capacity}
        roster={roster}
        readinessByBooking={readinessByBooking}
        waiverByBooking={waiverByBooking}
        rentalFitByBooking={rentalFitByBooking}
        nitroxByBooking={nitroxByBooking}
        requiresPayment={Boolean(requirement?.requiresPayment)}
        issueWaiverAction={issueWaiverAction.bind(null, shopSlug, tripId)}
        markPaymentAction={markPaymentAction.bind(null, shopSlug, tripId)}
        removeBookingAction={removeBookingAction.bind(null, shopSlug, tripId)}
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
    </main>
  );
}
