import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { JumpNav } from "@/components/JumpNav";
import { UndoToast } from "@/components/UndoToast";
import {
  canPersonDeleteDiver,
  canPersonErasePersonalData,
  canPersonOverrideGearRequest,
  canPersonRefund,
} from "@/db/authz";
import { getDb } from "@/db/client";
import { getDiverProfile } from "@/db/divers";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireStaffSession } from "@/lib/session";
import { BookActivity } from "./_components/BookActivity";
import { CertificationCards } from "./_components/CertificationCards";
import { DiverHeader } from "./_components/DiverHeader";
import { DIVER_SECTIONS, DiverSection } from "./_components/DiverSections";
import { ErasePersonalData } from "./_components/ErasePersonalData";
import { NoticeBanner } from "./_components/NoticeBanner";
import { PaymentsSection } from "./_components/PaymentsSection";
import { RemoveDiver } from "./_components/RemoveDiver";
import { RentalFit } from "./_components/RentalFit";
import { ShopHistory } from "./_components/ShopHistory";
import { SpecialtyCards } from "./_components/SpecialtyCards";
import { StatsSummary } from "./_components/StatsSummary";
import { UpcomingTripsSection } from "./_components/UpcomingTripsSection";
import { restoreCardAction } from "./actions";

// Not a TODO. The shop layout above already permits this route's blocking
// prerender (`isPageAllowedToBlock` reads only the outermost `instant`), so what
// this line still buys is keeping the page segment out of dev-time instant
// validation — which nothing above a page segment can do.
// See ADR 20260803-instant-opt-out-placement.
export const instant = false;

export const metadata: Metadata = { title: "Diver — DiveDay" };

/**
 * How many upcoming trips the "book on an upcoming trip" picker scans. Some
 * of the scanned trips get filtered out below (already booked, full), so
 * this is generously larger than what the picker actually shows.
 */
const BOOK_ACTIVITY_TRIP_SCAN_LIMIT = 50;

export default async function DiverDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; personId: string }>;
  searchParams: Promise<{
    notice?: string;
    undo?: string;
    cardType?: string;
    gate?: string;
    edit?: string;
  }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, personId } = await params;
  const { notice, undo, cardType, gate, edit } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  const diver = shop ? await getDiverProfile(db, shop.id, personId) : null;
  if (!shop || !diver) notFound();
  // Refunds and diver deletion are owner/manager only (H-14, ADR
  // 20260724-role-authorization); hide those controls from other staff. The
  // server actions re-check regardless — hiding is a courtesy, not the gate.
  // Rewriting a diver's stated rental fit is instructor/divemaster/manager work
  // (H-06); flagging them for hands-on fitting stays open to all staff.
  // Erasing a diver's personal and medical data is stricter still — owner only,
  // one way, and never offered to anyone else (ADR 20260802-diver-data-erasure).
  const [canRefund, canDelete, canOverrideFit, canErase, stripeAccount] = await Promise.all([
    canPersonRefund(db, shop.id, session.user.personId),
    canPersonDeleteDiver(db, shop.id, session.user.personId),
    canPersonOverrideGearRequest(db, shop.id, session.user.personId),
    canPersonErasePersonalData(db, shop.id, session.user.personId),
    getShopStripeAccount(db, shop.id),
  ]);
  // `orders/new` refuses outright without a payable account, so the Payments
  // section offers "Connect payments" rather than invoice buttons that bounce.
  const paymentsConnected = canAcceptPayments(stripeAccount);
  const { trips: scannedTrips } = await pagedUpcomingTripsWithCounts(db, shop.id, {
    limit: BOOK_ACTIVITY_TRIP_SCAN_LIMIT,
  });
  const upcoming = scannedTrips.filter(
    (trip) =>
      !diver.bookings.some(
        ({ booking }) => booking.tripId === trip.id && booking.status !== "cancelled",
      ) && trip.booked < trip.capacity,
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "undo", "cardType", "edit"]} />
      <DiverHeader
        diver={diver}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        // Only ever set by the roster's "Add a diver" form, which lands here
        // with a name and little else. `FlashParams` strips it from the URL
        // straight away, so a reload or a shared link is the ordinary
        // collapsed page.
        editOpen={edit === "1"}
      />
      {notice === "card-deleted" && undo && cardType ? (
        <UndoToast
          message={staffTranslator(locale)("divers.notices.cardRemovedToast")}
          action={restoreCardAction.bind(null, shopSlug, personId)}
          fields={{ certificationId: undo, cardType }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : (
        <NoticeBanner notice={notice} gate={gate} locale={locale} shopSlug={shopSlug} />
      )}
      {/* Above the stat cards, not below them: on a 390px phone those three
          cards stack, and a row sitting under them lands ~1,150px down — a spine
          you have to scroll to find is not a spine. */}
      <JumpNav
        ariaLabel={t("divers.subNav.ariaLabel")}
        items={DIVER_SECTIONS.map((section) => ({ id: section.id, label: t(section.labelKey) }))}
        className="mt-8"
      />
      <StatsSummary diver={diver} locale={locale} />
      <DiverSection id="cards">
        <CertificationCards diver={diver} shopSlug={shopSlug} personId={personId} shop={shop} />
        <SpecialtyCards
          diver={diver}
          shopSlug={shopSlug}
          personId={personId}
          shop={shop}
          locale={locale}
        />
      </DiverSection>
      <DiverSection id="fit">
        <RentalFit
          diver={diver}
          shopSlug={shopSlug}
          personId={personId}
          rentalItems={shop.rentalItems}
          canOverride={canOverrideFit}
          locale={locale}
        />
      </DiverSection>
      {/* Above "Book an activity" deliberately: the errand that brings staff to
          this page in a hurry is a diver standing at the counter with a bill,
          not one browsing next week's boats. Both used to sit below the fold;
          only one of them has somebody waiting. */}
      <DiverSection id="payments">
        <PaymentsSection
          locale={locale}
          diver={diver}
          shop={shop}
          shopSlug={shopSlug}
          personId={personId}
          canRefund={canRefund}
          paymentsConnected={paymentsConnected}
        />
      </DiverSection>
      <DiverSection id="trips">
        <BookActivity
          locale={locale}
          diver={diver}
          shop={shop}
          upcoming={upcoming}
          shopSlug={shopSlug}
          personId={personId}
        />
        <UpcomingTripsSection diver={diver} shop={shop} shopSlug={shopSlug} locale={locale} />
      </DiverSection>
      <DiverSection id="history">
        <ShopHistory locale={locale} diver={diver} shop={shop} shopSlug={shopSlug} />
      </DiverSection>
      {canDelete ? (
        <RemoveDiver diver={diver} shopSlug={shopSlug} personId={personId} locale={locale} />
      ) : null}
      {canErase ? (
        <ErasePersonalData diver={diver} shopSlug={shopSlug} personId={personId} locale={locale} />
      ) : null}
    </main>
  );
}
