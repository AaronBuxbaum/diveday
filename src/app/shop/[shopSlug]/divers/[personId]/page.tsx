import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
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

export const metadata: Metadata = { title: "Diver — Scuba" };

export default async function DiverDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; personId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, personId } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const diver = shop ? await getDiverProfile(db, shop.id, personId) : null;
  if (!shop || !diver) notFound();
  const upcoming = (await upcomingTripsWithCounts(db, shop.id)).filter(
    (trip) =>
      !diver.bookings.some(
        ({ booking }) => booking.tripId === trip.id && booking.status !== "cancelled",
      ) && trip.booked < trip.capacity,
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <DiverHeader shop={shop} diver={diver} shopSlug={shopSlug} personId={personId} />
      <NoticeBanner notice={notice} />
      <StatsSummary diver={diver} />
      <CertificationCards diver={diver} shopSlug={shopSlug} personId={personId} />
      <SpecialtyCards diver={diver} shopSlug={shopSlug} personId={personId} />
      <RentalFit diver={diver} shopSlug={shopSlug} personId={personId} />
      <BookActivity
        diver={diver}
        shop={shop}
        upcoming={upcoming}
        shopSlug={shopSlug}
        personId={personId}
      />
      <PaymentsSection diver={diver} shop={shop} shopSlug={shopSlug} personId={personId} />
      <ShopHistory diver={diver} shop={shop} shopSlug={shopSlug} />
      <RemoveDiver diver={diver} shopSlug={shopSlug} personId={personId} />
    </main>
  );
}
