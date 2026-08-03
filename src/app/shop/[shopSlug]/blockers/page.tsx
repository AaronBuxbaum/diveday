import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { OperationalWindowNote, readinessPivots } from "@/components/OperationalWindowNote";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { WaiverSendControl } from "@/components/today/WaiverSendControl";
import { buttonClass } from "@/components/ui/button";
import { getBlockerQueue } from "@/db/blockers";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import type { BlockerQueueTrip } from "@/lib/blockers";
import { distinctBlockedDivers, waiverBookingIds } from "@/lib/blockers";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz } from "@/lib/format";
import {
  BLOCKERS_TRIPS_PER_PAGE,
  OPERATIONAL_HORIZON_DAYS,
  pageOf,
} from "@/lib/operational-window";
import { requireStaffSession } from "@/lib/session";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Not ready — DiveDay",
};

function DiverRow({
  diver,
  shopSlug,
  t,
}: {
  diver: BlockerQueueTrip["divers"][number];
  shopSlug: string;
  t: ReturnType<typeof staffTranslator>;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-5 sm:px-5">
      <div className="min-w-0">
        <Link
          href={`/shop/${shopSlug}/divers/${diver.personId}`}
          className="font-semibold hover:text-primary hover:underline"
        >
          {diver.fullName}
        </Link>
        <ul className="mt-1.5 flex flex-col gap-1 text-base text-muted">
          {diver.blockers.map((blocker) => (
            <li key={blocker.code} className="flex gap-2">
              <span aria-hidden="true" className="text-danger">
                •
              </span>
              <span>{readinessBlockerText(t, blocker)}</span>
            </li>
          ))}
        </ul>
        {diver.alsoOn.length > 0 ? (
          <p className="mt-1.5 text-sm text-muted">
            {t("blockers.alsoBlockedOn", { trips: diver.alsoOn.join(", ") })}
          </p>
        ) : null}
      </div>
      {diver.fix.sendsWaiver ? (
        <WaiverSendControl
          shopSlug={shopSlug}
          surface="blockers"
          bookingIds={[diver.fix.bookingId]}
          label={diver.fix.label}
          copy={waiverSendCopy(t)}
        />
      ) : (
        <Link
          href={diver.fix.href}
          className={buttonClass({ variant: "secondary", className: "shrink-0" })}
        >
          {diver.fix.label}
        </Link>
      )}
    </li>
  );
}

function TripGroup({
  trip,
  shopSlug,
  timeZone,
  locale,
  t,
}: {
  trip: BlockerQueueTrip;
  shopSlug: string;
  timeZone: string;
  locale: string;
  t: ReturnType<typeof staffTranslator>;
}) {
  const batchIds = waiverBookingIds(trip);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-sunken px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link
              href={`/shop/${shopSlug}/trips/${trip.tripId}`}
              className="font-semibold hover:text-primary hover:underline"
            >
              {trip.title}
            </Link>
            {trip.courseTitle ? (
              <span className="text-sm font-medium text-primary">· {trip.courseTitle}</span>
            ) : null}
          </div>
          <p className="text-sm text-muted">{formatDateTimeTz(trip.startsAt, locale, timeZone)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          <span className="rounded-full bg-surface px-3 py-1 text-sm font-semibold tabular-nums">
            {t("blockers.tripBlockedCount", { blocked: trip.divers.length, booked: trip.booked })}
          </span>
          {batchIds.length > 1 ? (
            <WaiverSendControl
              shopSlug={shopSlug}
              surface="blockers"
              bookingIds={batchIds}
              label={t("blockers.sendAllWaivers", { count: batchIds.length })}
              pendingLabel={t("blockers.sendingAll")}
              copy={waiverSendCopy(t)}
            />
          ) : null}
        </div>
      </header>
      <ul className="divide-y divide-border">
        {trip.divers.map((diver) => (
          <DiverRow key={diver.bookingId} diver={diver} shopSlug={shopSlug} t={t} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Not ready is a lens on the same queue Today ranks, over the same shared
 * operational horizon (`src/lib/operational-window.ts`): Today answers "what
 * needs me before today's boats", this answers "who isn't ready on any boat in
 * the window" so the front desk can work the whole week ahead in one place.
 *
 * The horizon decides *which* departures; `BLOCKERS_TRIPS_PER_PAGE` decides how
 * many render at once, which is the separate problem a busy shop hits: this
 * list once rendered a ~10,700px unbroken scroll (26 departures, no pager — the
 * same shape the orders index was found in). A blocker list never truncates, so
 * the tail is paged, never dropped. `annotateAlsoOn` runs over every inspected
 * trip before the page is sliced, so a diver blocked on both trip 3 and trip 15
 * still reads "also blocked on" the other regardless of which page each lands on.
 */
export default async function BlockersPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { page: pageParam } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  if (!shop) notFound();

  const t = staffTranslator(locale);
  const { trips, truncated } = await getBlockerQueue(db, shop.id, shopSlug, nowDate(), t);
  const blocked = distinctBlockedDivers(trips);

  const {
    page,
    pageCount,
    items: visibleTrips,
  } = pageOf(trips, Number.parseInt(pageParam ?? "", 10), BLOCKERS_TRIPS_PER_PAGE);
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (target > 1) query.set("page", String(target));
    const search = query.toString();
    return search ? `/shop/${shopSlug}/blockers?${search}` : `/shop/${shopSlug}/blockers`;
  };

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("blockers.eyebrow")}
        title={t("blockers.title")}
        description={
          blocked === 0
            ? t("blockers.description.none")
            : t("blockers.description.some", { blocked, departures: trips.length })
        }
        // The same window sentence Today and Check-in print, in the same
        // place, plus the pivots to them (task 141, UX persona lens 17).
        meta={
          <OperationalWindowNote
            copy={{
              note: t("shared.operationalWindow.note", { days: OPERATIONAL_HORIZON_DAYS }),
              pivotsLabel: t("shared.operationalWindow.pivotsLabel"),
            }}
            pivots={readinessPivots(shopSlug, "blockers", {
              today: t("shared.shopNavLinks.today"),
              blockers: t("shared.shopNavLinks.blockers"),
              check_in: t("shared.shopNavLinks.checkIn"),
            })}
          />
        }
      />

      {trips.length === 0 ? (
        <section className="rounded-3xl border border-border bg-surface-sunken p-8 text-center sm:p-10">
          <div
            className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface text-2xl"
            aria-hidden="true"
          >
            🤿
          </div>
          <h2 className="mt-4 text-lg font-semibold">{t("blockers.emptyTitle")}</h2>
          <p className="mx-auto mt-1 max-w-md text-muted">{t("blockers.emptyDescription")}</p>
          <Link
            href={`/shop/${shopSlug}/schedule/board`}
            className={buttonClass({ className: "mt-5" })}
          >
            {t("blockers.viewSchedule")}
          </Link>
        </section>
      ) : (
        <div className="flex flex-col gap-5">
          {visibleTrips.map((trip) => (
            <TripGroup
              key={trip.tripId}
              trip={trip}
              shopSlug={shopSlug}
              timeZone={shop.timezone}
              locale={locale}
              t={t}
            />
          ))}
          {/* Only when there is somewhere to go — a shop with one screenful of
              blocked departures should not be told it is on "page 1 of 1". */}
          {pageCount > 1 ? (
            <nav
              aria-label={t("blockers.pagination.label")}
              className="flex items-center justify-between gap-3"
            >
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {t("blockers.pagination.previous")}
                </Link>
              ) : (
                <span />
              )}
              <p className="text-sm text-muted">
                {t("blockers.pagination.position", { page, pageCount, total: trips.length })}
              </p>
              {page < pageCount ? (
                <Link
                  href={pageHref(page + 1)}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {t("blockers.pagination.next")}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
          {truncated ? (
            <p className="text-center text-sm text-muted">
              {t.rich("blockers.truncated", {
                link: (chunks) => (
                  <Link
                    href={`/shop/${shopSlug}/schedule/board`}
                    className="font-medium text-primary hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          ) : null}
        </div>
      )}
    </main>
  );
}
