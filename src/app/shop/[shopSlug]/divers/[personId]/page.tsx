import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { UndoToast } from "@/components/UndoToast";
import { canPersonDeleteDiver, canPersonOverrideGearRequest, canPersonRefund } from "@/db/authz";
import { getDb } from "@/db/client";
import { getDiverProfile } from "@/db/divers";
import { getShopById } from "@/db/shops";
import { upcomingTripsWithCounts } from "@/db/trips";
import { requireStaffSession } from "@/lib/session";
import { BookActivity } from "./_components/BookActivity";
import { CertificationCards } from "./_components/CertificationCards";
import { DiverHeader } from "./_components/DiverHeader";
import { NoticeBanner } from "./_components/NoticeBanner";
import { PaymentsSection } from "./_components/PaymentsSection";
import { RemoveDiver } from "./_components/RemoveDiver";
import { RentalFit } from "./_components/RentalFit";
import { ShopHistory } from "./_components/ShopHistory";
import { SpecialtyCards } from "./_components/SpecialtyCards";
import { StatsSummary } from "./_components/StatsSummary";
import { restoreCardAction } from "./actions";

export const metadata: Metadata = { title: "Diver — DiveDay" };

export default async function DiverDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; personId: string }>;
  searchParams: Promise<{ notice?: string; undo?: string; cardType?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, personId } = await params;
  const { notice, undo, cardType } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const diver = shop ? await getDiverProfile(db, shop.id, personId) : null;
  if (!shop || !diver) notFound();
  // Refunds and diver deletion are owner/manager only (H-14, ADR
  // 20260724-role-authorization); hide those controls from other staff. The
  // server actions re-check regardless — hiding is a courtesy, not the gate.
  // Rewriting a diver's stated rental fit is instructor/divemaster/manager work
  // (H-06); flagging them for hands-on fitting stays open to all staff.
  const [canRefund, canDelete, canOverrideFit] = await Promise.all([
    canPersonRefund(db, shop.id, session.user.personId),
    canPersonDeleteDiver(db, shop.id, session.user.personId),
    canPersonOverrideGearRequest(db, shop.id, session.user.personId),
  ]);
  const upcoming = (await upcomingTripsWithCounts(db, shop.id)).filter(
    (trip) =>
      !diver.bookings.some(
        ({ booking }) => booking.tripId === trip.id && booking.status !== "cancelled",
      ) && trip.booked < trip.capacity,
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <FlashParams params={["notice", "undo", "cardType"]} />
      <DiverHeader diver={diver} shopSlug={shopSlug} personId={personId} />
      {notice === "card-deleted" && undo && cardType ? (
        <UndoToast
          message="Card removed."
          action={restoreCardAction.bind(null, shopSlug, personId)}
          fields={{ certificationId: undo, cardType }}
        />
      ) : (
        <NoticeBanner notice={notice} />
      )}
      <StatsSummary diver={diver} />
      <CertificationCards diver={diver} shopSlug={shopSlug} personId={personId} shop={shop} />
      <SpecialtyCards diver={diver} shopSlug={shopSlug} personId={personId} shop={shop} />
      <RentalFit
        diver={diver}
        shopSlug={shopSlug}
        personId={personId}
        rentalItems={shop.rentalItems}
        canOverride={canOverrideFit}
      />
      <BookActivity
        diver={diver}
        shop={shop}
        upcoming={upcoming}
        shopSlug={shopSlug}
        personId={personId}
      />
      <PaymentsSection
        diver={diver}
        shop={shop}
        shopSlug={shopSlug}
        personId={personId}
        canRefund={canRefund}
      />
      <ShopHistory diver={diver} shop={shop} shopSlug={shopSlug} />
      {canDelete ? <RemoveDiver diver={diver} shopSlug={shopSlug} personId={personId} /> : null}
    </main>
  );
}
