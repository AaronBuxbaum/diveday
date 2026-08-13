import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { TripPickerList } from "@/components/seat-diver/TripPickerList";
import { buttonClass } from "@/components/ui/button";
import { listWalkInTrips } from "@/db/check-in";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Walk-in — DiveDay",
};

/**
 * The fast counter path, step one: which boat?
 *
 * The diver half used to live on this same URL behind a `?tripId=`, and the
 * departure has moved into a path segment (`./[tripId]`) for the reason the
 * global Add-booking door did the same: a refusal has to land back on the form
 * that produced it, and appending a second query param to an already-queried
 * URL is the one shape a server-action redirect cannot land on — the client
 * router holds the page it already has and the submit button spins forever.
 * Moving the trip into the path is what lets the counter say *why* a diver
 * bounced instead of sending the staffer to the trip page to find out.
 */
export default async function WalkInPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ tripId?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { tripId } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop || shop.id !== session.user.shopId) notFound();
  const self = `/shop/${shopSlug}/check-in/walk-in`;
  // The shape this page used to take. A bookmark, a chat message, or a browser
  // that remembered the old URL lands on the same screen it always did rather
  // than on a trip picker with the choice silently dropped.
  if (tripId) redirect(`${self}/${encodeURIComponent(tripId)}`);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const trips = await listWalkInTrips(db, shop.id);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("checkIn.walkIn.eyebrow")}
        title={t("checkIn.walkIn.title")}
        description={t("checkIn.walkIn.description")}
      />
      <Link
        href={`/shop/${shopSlug}/check-in`}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        ← {t("checkIn.walkIn.backToQueue")}
      </Link>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">{t("checkIn.walkIn.tripLabel")}</h2>
        {trips.length === 0 ? (
          // The copy already names the schedule as where to look; this is
          // the link that sentence was describing.
          <EmptyState className="mt-2">
            <p className="mx-auto max-w-md text-sm text-muted">{t("checkIn.walkIn.tripEmpty")}</p>
            <Link
              href={`/shop/${shopSlug}/schedule/board`}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              {t("checkIn.walkIn.tripEmptyAction")}
            </Link>
          </EmptyState>
        ) : (
          <TripPickerList
            className="mt-3"
            options={trips.map((trip) => ({
              id: trip.tripId,
              href: `${self}/${trip.tripId}`,
              // JSX rather than template literals, for the same reason the
              // Add-booking picker keeps its own: text is shaped per DOM text
              // node, so joining these into single strings re-kerns across the
              // old node boundaries and shifts glyphs sub-pixel.
              label: (
                <>
                  {trip.title} ·{" "}
                  {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
                </>
              ),
              // A string, unlike `label` above: the same node-joining shifts
              // these two numbers sub-pixel, but writing them as JSX puts a
              // bare "/" text node in a component, which `pnpm check:copy`
              // rightly refuses. Two digits of sub-pixel shaping is the
              // cheaper side of that trade.
              meta: `${trip.booked}/${trip.capacity}`,
            }))}
          />
        )}
      </section>
    </main>
  );
}
