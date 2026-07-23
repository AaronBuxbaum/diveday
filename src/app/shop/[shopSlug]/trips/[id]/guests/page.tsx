import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listBookableDivers } from "@/db/divers";
import { getTripRequirements, listTripReadiness } from "@/db/readiness";
import { listRecapPhotosForTrip } from "@/db/recap";
import { listTripPrepDivers } from "@/db/rental-fit";
import { getShopById } from "@/db/shops";
import { getTripRoster, getTripWaitlist, getTripWithBooked } from "@/db/trips";
import { cancellationDeadline } from "@/lib/deposits";
import { nitroxTanksApproved } from "@/lib/dive-prep";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { capacityLabel, isFull } from "@/lib/trips";
import { AddDiverSection } from "../_components/AddDiverSection";
import { RecapPhotoGallery } from "../_components/RecapPhotoGallery";
import { RosterSection } from "../_components/RosterSection";
import { TripNoticeBanner } from "../_components/TripNoticeBanner";
import { WaitlistSection } from "../_components/WaitlistSection";
import {
  addBookingAction,
  addExistingDiverAction,
  addToWaitlistAction,
  bulkSendWaiversAction,
  deleteRecapPhotoAction,
  inviteWaitlistAction,
  issueWaiverAction,
  markPaymentAction,
  markWaiverInPersonAction,
  removeBookingAction,
  undoRemoveBookingAction,
} from "../actions";

export const metadata: Metadata = {
  title: "Trip guests — DiveDay",
};

/**
 * Who is attending — the one place the roster, wait list, and every per-diver
 * action (waiver, payment, rental fit, remove) live. What the dive *is* stays on
 * Overview; the day-of boarding and roll call live on the Manifest. Splitting
 * "who" from "what" is why every roster action has exactly one home.
 */
export default async function TripGuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string; bid?: string; waiver?: string; diverq?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { notice, bid, waiver, diverq } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();
  // The returning-diver picker only books, so it is skipped once the boat is
  // full — hand-entry then wait-lists instead.
  const diverQuery = diverq?.trim() ?? "";
  const diverCandidates =
    isFull(trip) || diverQuery === ""
      ? []
      : await listBookableDivers(db, shop.id, tripId, { query: diverQuery });
  const [roster, requirement, readinessRows, prepDivers, waitlist, recapPhotos] = await Promise.all(
    [
      getTripRoster(db, shop.id, tripId),
      getTripRequirements(db, shop.id, tripId),
      listTripReadiness(db, shop.id, tripId),
      listTripPrepDivers(db, shop.id, tripId),
      getTripWaitlist(db, shop.id, tripId),
      listRecapPhotosForTrip(db, shop.id, tripId),
    ],
  );
  // Undo is safe for every money-neutral removal but must never appear after a
  // real refund: restoreBooking can't un-refund, so it would re-seat a diver
  // whose money is already gone (dive-domain review).
  const undoBookingId =
    notice?.startsWith("booking-removed") && notice !== "booking-removed-refunded"
      ? bid
      : undefined;
  const cancelled = trip.status === "cancelled";
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
  const readinessByBooking = new Map(readinessRows.map((row) => [row.booking.id, row] as const));
  const waiverByBooking = new Map(
    readinessRows.map(
      (row) =>
        [row.booking.id, { booking: row.booking, person: row.person, waiver: row.waiver }] as const,
    ),
  );

  return (
    <>
      <FlashParams params={["notice", "bid", "waiver"]} />
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
          </div>
        }
      />

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
          shopSlug={shopSlug}
          full={isFull(trip)}
          query={diverQuery}
          candidates={diverCandidates}
          addBookingAction={addBookingAction.bind(null, shopSlug, tripId)}
          addToWaitlistAction={addToWaitlistAction.bind(null, shopSlug, tripId)}
          addExistingDiverAction={addExistingDiverAction.bind(null, shopSlug, tripId)}
        />
      )}

      <RosterSection
        shopSlug={shopSlug}
        shopTimezone={shop.timezone}
        booked={trip.booked}
        capacity={trip.capacity}
        roster={roster}
        readinessByBooking={readinessByBooking}
        waiverByBooking={waiverByBooking}
        rentalFitByBooking={rentalFitByBooking}
        nitroxByBooking={nitroxByBooking}
        requiresPayment={Boolean(requirement?.requiresPayment)}
        cancellationDeadline={cancellationDeadline(trip)}
        issueWaiverAction={issueWaiverAction.bind(null, shopSlug, tripId)}
        bulkSendWaiversAction={bulkSendWaiversAction.bind(null, shopSlug, tripId)}
        markWaiverInPersonAction={markWaiverInPersonAction.bind(null, shopSlug, tripId)}
        markPaymentAction={markPaymentAction.bind(null, shopSlug, tripId)}
        removeBookingAction={removeBookingAction.bind(null, shopSlug, tripId)}
      />

      <RecapPhotoGallery
        photos={recapPhotos}
        removeAction={deleteRecapPhotoAction.bind(null, shopSlug, tripId)}
      />
    </>
  );
}
