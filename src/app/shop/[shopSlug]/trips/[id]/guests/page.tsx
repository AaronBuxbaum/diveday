import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { UndoToast } from "@/components/UndoToast";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listBookableDivers } from "@/db/divers";
import { listLastMinuteList } from "@/db/last-minute-list";
import { listBookingNotes, listTripActivity } from "@/db/operations";
import { getTripRequirements, listTripReadiness } from "@/db/readiness";
import { listTripPrepDivers } from "@/db/rental-fit";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { listTripLastMinutePromos } from "@/db/trip-promos";
import { getTripRoster, getTripWaitlist, getTripWithBooked } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { demandRecommendation } from "@/lib/demand";
import { cancellationDeadline } from "@/lib/deposits";
import { nitroxTanksApproved } from "@/lib/dive-prep";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { lastMinuteEntryMatchesTripDate } from "@/lib/last-minute-list";
import { requireStaffSession } from "@/lib/session";
import { capacityLabel, isFull, spotsRemaining } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { AddDiverSection } from "../_components/AddDiverSection";
import { CelebrationsSection } from "../_components/CelebrationsSection";
import { LastMinuteDealSection } from "../_components/LastMinuteDealSection";
import { isRosterFilter, RosterSection } from "../_components/RosterSection";
import { TripNoticeBanner } from "../_components/TripNoticeBanner";
import { WaitlistSection } from "../_components/WaitlistSection";
import {
  addInternalNoteAction,
  addToWaitlistAction,
  confirmDiverIdentityAction,
  deleteInternalNoteAction,
  inviteWaitlistAction,
  markPaymentAction,
  markWaiverInPersonAction,
  removeBookingAction,
  restoreInternalNoteAction,
  saveRosterEmergencyContactAction,
  sendLastMinuteDealAction,
  undoRemoveBookingAction,
} from "../actions";

export const metadata: Metadata = {
  title: "Trip guests — DiveDay",
};

type TripGuestsSearchParams = Promise<{
  notice?: string;
  bid?: string;
  diverq?: string;
  count?: string;
  rf?: string;
  /** The deleted note's booking + text, carried by the land-then-undo redirect (§7). */
  noteBookingId?: string;
  noteBody?: string;
}>;

/**
 * Who is attending — the one place the roster, wait list, and every per-diver
 * action (waiver, payment, rental fit, remove) live. What the dive *is* stays on
 * Overview; the day-of boarding and roll call live on the Manifest. Splitting
 * "who" from "what" is why every roster action has exactly one home.
 *
 * Not `instant = false`, which (per
 * node_modules/next/dist/docs/.../instant.md) is a dev-time validation
 * opt-out only and has no effect on production rendering. Without a real
 * Suspense boundary, this route still gets a Partial-Prerendered static
 * shell with an implicit dynamic hole around the unwrapped
 * `searchParams`/session reads — and `addBookingAction`'s
 * `revalidateAndRedirect(...?notice=diver-added...)` (the shared
 * src/app/actions/seat-diver.ts) raced
 * that hole's own pending fetch, matching the class of bug fixed on
 * /sign-in, dive-sites/new, and trips/new. This action lives in a sibling
 * `actions.ts` rather than this file, which is also why the earlier grep for
 * this bug class (co-located `redirect(` in the same `page.tsx`) missed it.
 * (`addBookingAction` is now the shared `seatNewDiverAction`; the hazard and
 * the reason for the Suspense boundary are unchanged.)
 */
export default function TripGuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: TripGuestsSearchParams;
}) {
  return (
    <Suspense fallback={null}>
      <TripGuestsBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function TripGuestsBody({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: TripGuestsSearchParams;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { notice, bid, diverq, count, rf, noteBookingId, noteBody } = await searchParams;
  const rosterFilter = isRosterFilter(rf) ? rf : "all";
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
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
  const [
    roster,
    requirement,
    readinessRows,
    prepDivers,
    waitlist,
    lastMinuteList,
    lastMinutePromos,
    bookingNotes,
    activity,
    stripeAccount,
  ] = await Promise.all([
    getTripRoster(db, shop.id, tripId),
    getTripRequirements(db, shop.id, tripId),
    listTripReadiness(db, shop.id, tripId),
    listTripPrepDivers(db, shop.id, tripId),
    getTripWaitlist(db, shop.id, tripId),
    listLastMinuteList(db, shop.id),
    listTripLastMinutePromos(db, shop.id, tripId),
    listBookingNotes(db, shop.id, tripId),
    listTripActivity(db, shop.id, tripId),
    getShopStripeAccount(db, shop.id),
  ]);
  // `orders/new` refuses without a payable account, so each seat's "Create
  // order" link points at connecting one instead of at a door that bounces.
  const paymentsConnected = canAcceptPayments(stripeAccount);
  const demand = demandRecommendation({
    capacity: trip.capacity,
    booked: trip.booked,
    waitlisted: waitlist.length,
  });
  const notesByBooking = new Map<string, typeof bookingNotes>();
  for (const row of bookingNotes) {
    if (!row.note.bookingId) continue;
    const rows = notesByBooking.get(row.note.bookingId) ?? [];
    rows.push(row);
    notesByBooking.set(row.note.bookingId, rows);
  }
  const tripDateIso = toDateInputValue(utcToWallTime(trip.startsAt, shop.timezone));
  const lastMinuteEligibleCount = lastMinuteList.filter(({ entry }) =>
    lastMinuteEntryMatchesTripDate(entry, tripDateIso),
  ).length;
  // Undo is safe for every money-neutral removal but must never appear after a
  // real refund: restoreBooking can't un-refund, so it would re-seat a diver
  // whose money is already gone (dive-domain review).
  const undoBookingId =
    notice?.startsWith("booking-removed") && notice !== "booking-removed-refunded"
      ? bid
      : undefined;
  const cancelled = trip.status === "cancelled";
  const capacityLabelValue = capacityLabel(trip);
  const capacityText =
    capacityLabelValue.kind === "full"
      ? t("shared.capacity.full")
      : t("shared.capacity.spotsLeft", { count: capacityLabelValue.remaining });
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
      <FlashParams params={["notice", "bid", "noteBookingId", "noteBody"]} />
      <ShopPageHeader
        eyebrow={t("trips.guests.eyebrow")}
        title={trip.title}
        meta={
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              {cancelled ? (
                <Badge tone="danger">{t("trips.guests.cancelledBadge")}</Badge>
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
            {trip.course ? (
              <p className="text-sm font-medium text-primary">
                {t("trips.guests.courseSession", { title: trip.course.title })}
              </p>
            ) : null}
          </div>
        }
      />

      {/* A deleted private note is a purely reversible edit, so it gets a
          land-then-undo toast instead of the plain success banner
          (docs/design/principles.md §7) — same either/or as
          divers/[personId]/page.tsx's card-delete undo. */}
      {notice === "note-deleted" && noteBookingId && noteBody ? (
        <UndoToast
          message={t("trips.roster.noteDeletedToast")}
          action={restoreInternalNoteAction.bind(null, shopSlug, tripId)}
          fields={{ bookingId: noteBookingId, body: noteBody }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : (
        <TripNoticeBanner
          notice={notice}
          count={count}
          locale={locale}
          undoBookingId={undoBookingId}
          undoAction={undoRemoveBookingAction.bind(null, shopSlug, tripId)}
        />
      )}

      <WaitlistSection
        waitlist={waitlist}
        shopSlug={shopSlug}
        tripId={tripId}
        shopName={shop.name}
        tripTitle={trip.title}
        tripWhen={formatShortDate(trip.startsAt, locale, shop.timezone)}
        inviteAction={inviteWaitlistAction.bind(null, shopSlug, tripId)}
        locale={locale}
      />

      {demand ? (
        <section className="mt-6 rounded-xl border border-warning/40 bg-warning/10 p-5">
          <p className="text-xs font-semibold tracking-widest text-warning uppercase">
            {t("trips.guests.demandSignal")}
          </p>
          <h2 className="mt-1 text-lg font-semibold">{t("trips.guests.demandHeading")}</h2>
          <p className="mt-1 text-sm text-muted">{demand.message}</p>
          <Link
            href={`/shop/${shopSlug}/trips/new`}
            className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
          >
            {t("trips.guests.scheduleAnotherDeparture")}
          </Link>
        </section>
      ) : null}

      {cancelled ? null : (
        <AddDiverSection
          shopSlug={shopSlug}
          full={isFull(trip)}
          query={diverQuery}
          candidates={diverCandidates}
          tripId={tripId}
          addBookingAction={seatNewDiverAction.bind(null, "trip-guests", shopSlug)}
          addToWaitlistAction={addToWaitlistAction.bind(null, shopSlug, tripId)}
          addExistingDiverAction={seatExistingDiverAction.bind(null, "trip-guests", shopSlug)}
          locale={locale}
        />
      )}

      {/* Sits above the roster so the good news is read before the blockers
          (H-21). Renders nothing when nobody on board is celebrating. */}
      <CelebrationsSection roster={roster} tripDate={tripDateIso} locale={locale} />

      <RosterSection
        locale={locale}
        shopSlug={shopSlug}
        shopTimezone={shop.timezone}
        tripId={tripId}
        booked={trip.booked}
        capacity={trip.capacity}
        roster={roster}
        rosterFilter={rosterFilter}
        readinessByBooking={readinessByBooking}
        waiverByBooking={waiverByBooking}
        rentalFitByBooking={rentalFitByBooking}
        nitroxByBooking={nitroxByBooking}
        requiresPayment={Boolean(requirement?.requiresPayment)}
        paymentsConnected={paymentsConnected}
        cancellationDeadline={cancellationDeadline(trip)}
        markWaiverInPersonAction={markWaiverInPersonAction.bind(null, shopSlug, tripId)}
        markPaymentAction={markPaymentAction.bind(null, shopSlug, tripId)}
        removeBookingAction={removeBookingAction.bind(null, shopSlug, tripId)}
        confirmIdentityAction={confirmDiverIdentityAction.bind(null, shopSlug, tripId)}
        notesByBooking={notesByBooking}
        addNoteAction={addInternalNoteAction.bind(null, shopSlug, tripId)}
        deleteNoteAction={deleteInternalNoteAction.bind(null, shopSlug, tripId)}
        saveEmergencyContactAction={saveRosterEmergencyContactAction.bind(null, shopSlug, tripId)}
        depthUnit={shop.depthUnit}
        tripDate={tripDateIso}
      />

      <section className="mt-10">
        <h2 className="text-lg font-semibold">{t("trips.guests.activityHeading")}</h2>
        {activity.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("trips.guests.noActivity")}</p>
        ) : (
          <ol className="mt-4 grid gap-2">
            {activity.map((event) => (
              <li key={event.id} className="rounded-lg bg-surface-sunken px-4 py-3 text-sm">
                <span>{event.message}</span>
                <span className="ml-2 text-muted">
                  {formatDateTimeTz(event.occurredAt, locale, shop.timezone)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* The marketing blast collapses behind its own disclosure (task 156,
          UX persona lens 17) — Guests is "who is attending," not a promo
          console. Collapsed by default; the trip's own recipient count still
          shows on the closed summary, and Today's "fill seats" row still
          lands here and auto-opens it (its href is this section's own
          #last-minute-deal anchor). A hard navigation opens a closed
          ancestor <details> for a same-page anchor on its own, but a
          Next.js <Link> transition doesn't run that native "reveal"
          algorithm — AutoOpenDetails covers both. */}
      <AutoOpenDetails
        openOnHash="last-minute-deal"
        className="group mt-10 scroll-mt-6 rounded-lg border border-border bg-surface"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>{t("trips.guests.promoteHeading")}</span>
          <span className="flex items-center gap-2 text-muted">
            {lastMinutePromos.length > 0
              ? t("trips.guests.promoteSentCount", { count: lastMinutePromos.length })
              : null}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4 transition-transform group-open:rotate-180"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </summary>
        <div className="border-t border-border px-4">
          <LastMinuteDealSection
            locale={locale}
            eligibleCount={lastMinuteEligibleCount}
            openSeats={spotsRemaining({ capacity: trip.capacity, booked: trip.booked })}
            cancelled={cancelled}
            promos={lastMinutePromos}
            timezone={shop.timezone}
            sendAction={sendLastMinuteDealAction.bind(null, shopSlug, tripId)}
          />
        </div>
      </AutoOpenDetails>
    </>
  );
}
