import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { spotsRemaining } from "@/lib/trips";

export const metadata: Metadata = {
  title: "Add a booking — DiveDay",
  // Staff-only operations surface, never a public document.
  robots: { index: false, follow: false },
};

/**
 * How many departures the picker offers at once. A page, not a shop's whole
 * future: a busy season has hundreds of upcoming departures, and a picker that
 * rendered all of them would be a screen nobody can scan (AGENTS.md — bound
 * the page, not the capture). Anything past this is one link away on the
 * board, which is the surface built for scrolling the season.
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
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  await connection(); // live seat counts — render per request, never a build-time shell
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const db = await getDb();
  // Scoped by the session's own shop, never the URL slug.
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const { trips, nextCursor } = await pagedUpcomingTripsWithCounts(db, shop.id, {
    hasSpace: true,
    limit: TRIP_PAGE_SIZE,
  });

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

      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">{t("bookings.new.tripHeading")}</h2>
        {/* The list is filtered to departures with a seat left, and a filter
            nobody announced reads as a missing departure: a sold-out Saturday
            simply wasn't here, with nothing on screen to say why or what to do
            about it. Says both, and names the board as the place to do it. */}
        <p className="mt-1 text-sm text-muted">{t("bookings.new.fullExcluded")}</p>
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
            <ul className="mt-3 flex flex-col gap-2">
              {trips.map((trip) => (
                <li key={trip.id}>
                  <Link
                    href={`/shop/${shopSlug}/bookings/new/${trip.id}`}
                    className="flex min-h-11 items-baseline justify-between gap-3 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-sm font-medium hover:border-primary/40"
                  >
                    {/* The title wraps inside its own column rather than
                        pushing the seat count onto a second line: a list
                        scanned for "where does this diver fit" needs its
                        numbers in one straight, right-aligned run. */}
                    <span className="min-w-0 flex-1">
                      {trip.title} · {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
                      {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
                    </span>
                    {/* Seats left, not "booked/capacity": the question at this
                        moment is whether this diver fits. */}
                    <span className="shrink-0 tabular-nums text-muted">
                      {t("bookings.new.seatsLeft", { count: spotsRemaining(trip) })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {nextCursor ? (
              <Link
                href={`/shop/${shopSlug}/schedule/board`}
                className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
              >
                {t("bookings.new.moreOnBoard")}
              </Link>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
