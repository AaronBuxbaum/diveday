import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { TripPickerList } from "@/components/seat-diver/TripPickerList";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { offsetUpcomingTripsWithCounts } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { spotsRemaining } from "@/lib/trips";

// `instant = true` asserts that navigating *into* this page paints
// immediately. Not a claim of a static shell: the staff shell layout declares
// `instant = false` (read its comment for why), so a cold direct visit still
// blocks on the session and shop row. What this validates is the navigation
// staff make all day — arriving from another `/shop` page, where the shell
// is already mounted. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Add a booking — DiveDay",
  // Staff-only operations surface, never a public document.
  robots: { index: false, follow: false },
};

/**
 * How many departures the picker offers at once. A page, not a shop's whole
 * future: a busy season has hundreds of upcoming departures, and a picker that
 * rendered all of them would be a screen nobody can scan (AGENTS.md — bound
 * the page, not the capture).
 *
 * Anything past this used to be reachable only by leaving for the schedule
 * board — the one place staff still met "go look somewhere else" where every
 * other list says "page 2 of 4" (ADR 20260803-one-pagination-model). It pages
 * in place now; the board link above stays, because the board is still where
 * you go to *change* the schedule rather than book against it.
 */
const TRIP_PAGE_SIZE = 24;

/**
 * The global "Add a booking" door, step one: which departure?
 *
 * Every other staff door starts somewhere else — a trip you already opened, a
 * diver record you already found, the check-in counter — so "someone just
 * called, put them on Saturday's boat" meant navigating to a trip first just
 * to reach a form. This is the same two decisions in their natural order:
 * which departure (here), then who (`./[tripId]/page.tsx`).
 *
 * The chosen departure is a path segment, not a `?tripId=`, because it is a
 * *place* the staffer is standing — bookmarkable, shareable, and the URL a
 * refusal can bounce back to while adding only its own `?notice=`.
 */
export default async function NewBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await connection(); // live seat counts — render per request, never a build-time shell
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { page } = await searchParams;
  const db = await getDb();
  // Scoped by the session's own shop, never the URL slug.
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range so a bookmarked page past the end lands on the last real one.
  const tripPage = await offsetUpcomingTripsWithCounts(db, shop.id, {
    hasSpace: true,
    limit: TRIP_PAGE_SIZE,
    page: Number.parseInt(page ?? "", 10),
  });
  const trips = tripPage.trips;
  const self = `/shop/${shopSlug}/bookings/new`;
  const pageHref = (target: number) => (target > 1 ? `${self}?page=${target}` : self);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("bookings.new.eyebrow")}
        title={t("bookings.new.title")}
        description={t("bookings.new.description")}
      />
      <Link
        href={`/shop/${shopSlug}/schedule/board`}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        ← {t("bookings.new.backToBoard")}
      </Link>

      <div className="mt-6">
        <SectionCard
          title={t("bookings.new.tripHeading")}
          description={t("bookings.new.fullExcluded")}
          padding="lg"
        >
          {/* The list is filtered to departures with a seat left, and a filter
            nobody announced reads as a missing departure: a sold-out Saturday
            simply wasn't here, with nothing on screen to say why or what to do
            about it. Says both, and names the board as the place to do it. */}
          {trips.length === 0 ? (
            // "Put a departure on the board first" now goes to the board.
            <EmptyState className="mt-2">
              <p className="mx-auto max-w-md text-sm text-muted">{t("bookings.new.tripEmpty")}</p>
              <Link
                href={`/shop/${shopSlug}/schedule/board`}
                className={buttonClass({ className: "mt-4" })}
              >
                {t("bookings.new.tripEmptyAction")}
              </Link>
            </EmptyState>
          ) : (
            <>
              {/* The shared picker row, also worn by the counter walk-in. Seats
                left, not "booked/capacity": the question at this moment is
                whether this diver fits. */}
              <TripPickerList
                options={trips.map((trip) => ({
                  id: trip.id,
                  href: `/shop/${shopSlug}/bookings/new/${trip.id}`,
                  // Kept as JSX, not a template literal: the browser shapes text
                  // per DOM text node, so collapsing these three expressions and
                  // their separators into one string re-kerns across what were
                  // node boundaries and moves glyphs by a fraction of a pixel.
                  // Invisible to a reader, but a real visual-regression diff.
                  label: (
                    <>
                      {trip.title} · {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
                      {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
                    </>
                  ),
                  meta: t("bookings.new.seatsLeft", { count: spotsRemaining(trip) }),
                }))}
              />
              <Pager
                page={tripPage.page}
                pageCount={tripPage.pageCount}
                href={pageHref}
                total={t("bookings.new.pagination.total", { count: tripPage.total })}
                t={t}
                className="mt-4"
              />
            </>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
