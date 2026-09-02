import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { listBoats } from "@/db/boats";
import { getDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked, pagedUpcomingTripsWithCounts } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import { requestTranslator } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import { isEmbedWidget } from "@/lib/embed-routes";
import { formatDayParts, formatMoneyScanned, formatTimeRange } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import { publicCoursePath, publicSchedulePath, publicTripPath } from "@/lib/public-routes";
import { capacityLabel } from "@/lib/trips";
import { EmbedHeightReporter } from "./_components/EmbedHeightReporter";

// The widget is only ever framed, so it paints inside its own shell like every
// route (ADR 20260804-instant-navigation).
export const instant = true;

/**
 * Three thin views of the shop's own content, each a fragment of a page a
 * search engine already has: never indexed as pages of their own.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * **The embed catalogue's framed widgets** (Harbor — ADR
 * 20260901-diveday-reimagined, decision 2): `grid` (trips and courses as
 * cards), `departure` (one departure as a card, for a blog post) and `courses`
 * (the list). Each exists only to be framed by `public/embed.js` on a shop's
 * own website — the proxy marks the path an embed request, so the layout drops
 * its chrome and admits framing — and each wears whatever the host page or the
 * shop set, through the same `BrandStyle` the storefront reads. Every card's
 * one action leaves the frame for the real page (`target="_top"`), because the
 * booking and its payment never run inside someone else's iframe (ADR
 * 20260726-schedule-embed).
 */
export default async function EmbedWidgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; widget: string }>;
  searchParams: Promise<{ show?: string | string[]; credit?: string | string[] }>;
}) {
  const { shopSlug, widget } = await params;
  if (!isEmbedWidget(widget)) notFound();
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();
  const { t, locale } = await requestTranslator(shop.defaultLocale);
  const currency = toShopCurrency(shop.currency);
  const { show, credit } = await searchParams;
  const showId = typeof show === "string" ? show : null;
  // The loader draws the crawlable credit on the host page and says so; a
  // frame hand-written without it keeps its own. One line per widget.
  const hostCarriesCredit = credit === "host";
  const boatName = new Map((await listBoats(db, shop.id)).map((boat) => [boat.id, boat.name]));
  const now = nowDate();
  const origin = publicAppUrl() ?? "";
  const tz = shop.timezone;

  const money = (cents: number | null) =>
    cents === null ? null : formatMoneyScanned(cents, currency, locale);
  // The day and the time *range* — a diver reading a card on a blog post
  // wants to know when they are back, not only when they leave.
  const when = (startsAt: Date, endsAt: Date) => {
    const parts = formatDayParts(startsAt, locale, tz);
    return `${parts.weekday} ${parts.day} ${parts.month} · ${formatTimeRange(startsAt, endsAt, locale, tz)}`;
  };
  const seats = (trip: { capacity: number; booked: number }) => {
    const label = capacityLabel(trip);
    if (label.kind === "full") return t("fallback.full");
    return label.remaining <= 2
      ? t("schedule.spotsLeftUrgent", { count: label.remaining })
      : t("fallback.spotsLeft", { count: label.remaining });
  };

  let body: React.ReactNode;
  if (widget === "departure") {
    const trip = showId ? await getTripWithBooked(db, shop.id, showId) : null;
    if (!trip || trip.isPrivate) notFound();
    body = (
      <DepartureCard
        title={trip.title}
        when={when(trip.startsAt, trip.endsAt)}
        site={
          [trip.diveSite?.name, trip.boatId ? boatName.get(trip.boatId) : null]
            .filter(Boolean)
            .join(" · ") || null
        }
        price={money(trip.priceCents)}
        seats={seats(trip)}
        href={`${origin}${publicTripPath(shopSlug, trip.id)}#book`}
        t={t}
      />
    );
  } else if (widget === "courses") {
    const courses = await listActiveCourses(db, shop.id);
    body = (
      <ul className="divide-y divide-border rounded-panel border border-border bg-surface shadow-bed">
        {courses.map((course) => (
          <li
            key={course.id}
            className="flex min-h-14 items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="font-brand-display font-semibold">{course.title}</p>
              {course.summary ? (
                <p className="line-clamp-1 text-sm text-muted">{course.summary}</p>
              ) : null}
              {/* How long, in the shop's own words — the course index says it,
                  and a list that dropped it was thinner than the page it stands for. */}
              {course.durationText ? (
                <p className="text-xs text-muted">{course.durationText}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {course.priceCents !== null ? (
                <span className="font-semibold tabular-nums">{money(course.priceCents)}</span>
              ) : null}
              <Link
                href={`${origin}${publicCoursePath(shopSlug, course.slug)}`}
                target="_top"
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("embed.enrol")}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    );
  } else {
    const [{ trips }, courses] = await Promise.all([
      pagedUpcomingTripsWithCounts(db, shop.id, { now, limit: 6, publicOnly: true }),
      listActiveCourses(db, shop.id),
    ]);
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {trips.map((trip) => (
          <DepartureCard
            key={trip.id}
            title={trip.title}
            when={when(trip.startsAt, trip.endsAt)}
            site={
              [trip.diveSite?.name, trip.boatId ? boatName.get(trip.boatId) : null]
                .filter(Boolean)
                .join(" · ") || null
            }
            price={money(trip.priceCents)}
            seats={seats(trip)}
            href={`${origin}${publicTripPath(shopSlug, trip.id)}#book`}
            t={t}
          />
        ))}
        {courses.slice(0, 3).map((course) => (
          <article
            key={course.id}
            className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-4 shadow-bed"
          >
            <h2 className="font-brand-display text-base font-semibold">{course.title}</h2>
            {course.summary ? (
              <p className="line-clamp-2 text-sm text-muted">{course.summary}</p>
            ) : null}
            <div className="mt-auto flex items-center justify-between gap-3 pt-2">
              <span className="font-semibold tabular-nums">{money(course.priceCents) ?? ""}</span>
              <Link
                href={`${origin}${publicCoursePath(shopSlug, course.slug)}`}
                target="_top"
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("embed.enrol")}
              </Link>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <main className="w-full p-3">
      {body}
      {hostCarriesCredit ? null : (
        <p className="mt-3 text-center text-xs text-muted">
          <Link
            href={`${origin}${publicSchedulePath(shopSlug)}`}
            target="_top"
            className="hover:underline"
          >
            {t("schedule.poweredByDiveDay")}
          </Link>
        </p>
      )}
      <EmbedHeightReporter />
    </main>
  );
}

function DepartureCard({
  title,
  when,
  site,
  price,
  seats,
  href,
  t,
}: {
  title: string;
  when: string;
  site: string | null;
  price: string | null;
  seats: string;
  href: string;
  t: DiverTranslator;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-4 shadow-bed">
      <h2 className="font-brand-display text-base font-semibold">{title}</h2>
      <p className="text-sm tabular-nums">{when}</p>
      {site ? <p className="text-sm text-muted">{site}</p> : null}
      <div className="mt-auto flex items-center justify-between gap-3 pt-2">
        <span className="text-sm">
          {price ? <span className="font-semibold tabular-nums">{price}</span> : null}
          {price ? " · " : ""}
          <span className="text-muted">{seats}</span>
        </span>
        <Link href={href} target="_top" className={buttonClass({ size: "sm" })}>
          {t("embed.book")}
        </Link>
      </div>
    </article>
  );
}
