import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { getDb } from "@/db/client";
import { shopBySlugCached } from "@/features/shops-cached";
import { requestTranslator } from "@/i18n/request";
import { timeZoneLabel } from "@/i18n/timezone-labels";
import { nowDate } from "@/lib/clock";
import { toShopCurrency } from "@/lib/money";
import { EmbedChromeCollapse } from "../../_components/EmbedChromeCollapse";
import { EmbedFooter } from "../../_components/EmbedFooter";
import { SchedulePaperSheet } from "../../_components/SchedulePaperSheet";
import { readSchedulePage } from "../../_components/schedule-reads";
import { weekLedgerRows } from "../../_components/schedule-rows";
import { scheduleDayWords } from "../../_components/schedule-view";
import { WeekLedger } from "../../_components/WeekLedger";
import { generateMetadata as scheduleMetadata } from "../../page";

// The frame paints inside its own shell like every route (ADR
// 20260804-instant-navigation), and that shell is the reason this segment
// exists: its `loading.tsx` is the frame's list rather than the storefront's.
export const instant = true;

/**
 * **How many departures the widget shows before it hands over** (issue #805).
 * The recommended snippet frames this page at 900px tall; a frame cannot guess
 * the right height, so the widget is a window onto the schedule (the next few
 * departures and one link to the real page) rather than the schedule.
 */
const EMBED_TRIP_LIMIT = 4;

/** The storefront's own, canonical and all: a frame points search engines at the page. */
export function generateMetadata(props: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  return scheduleMetadata(props);
}

/**
 * **The framed calendar** (K-371; ADR 20260726-schedule-embed, amendment
 * 2026-11-03; issue #2744): `/s/<slug>/embed/calendar`, the path the loader
 * and the generator frame. It is framable because of where it is
 * (`isEmbedRoute` in `src/lib/embed-routes.ts`), and its `loading.tsx` is the
 * frame's own list rather than the storefront's.
 *
 * It composes the same reads and the same ledger rows the storefront does, and
 * nothing else: what a frame omits (the identity band, the filters, the month
 * rail, the shelves, reviews, the boats block, structured data) is simply not
 * in this page, so the storefront no longer asks which frame it is in.
 * `EmbedChromeCollapse` goes on keeping the layout's chrome bar hidden if this
 * lands before the chrome does.
 */
export default async function EmbeddedSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    /** `host` when the loader drew the credit on the host page — see `public/embed.js`. */
    credit?: string;
  }>;
}) {
  await connection(); // live data — render per request, never a build-time shell
  const { shopSlug } = await params;
  const { credit } = await searchParams;
  const db = await getDb();
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) notFound();

  const tz = shop.timezone;
  const { locale, t } = await requestTranslator(shop.defaultLocale);
  const now = nowDate();
  const { range, upcoming, diveSitesByTrip, requirementsByTrip } = await readSchedulePage(
    db,
    shop,
    {
      isEmbed: true,
      lens: undefined,
      cursor: { after: undefined, before: undefined },
      now,
      listMonthBounds: null,
      hasSpaceFilter: false,
      tripTypeFilter: undefined,
    },
  );

  const zoneAnchor = upcoming[0]?.startsAt ?? range.first;
  const zoneNote = zoneAnchor
    ? t("schedule.timesInZoneFooter", {
        shop: shop.name,
        zone: timeZoneLabel(zoneAnchor, locale, tz),
      })
    : null;
  const listedTrips = upcoming.slice(0, EMBED_TRIP_LIMIT);
  const { dayKeyOf } = scheduleDayWords(now, locale, tz);
  const rows = weekLedgerRows({
    listedTrips,
    lenses: [],
    diveSitesByTrip,
    requirementsByTrip,
    aboveStatedLevel: new Set(),
    dayKeyOf,
    shopSlug,
    isEmbed: true,
    timezone: tz,
    currency: toShopCurrency(shop.currency),
    locale,
    t,
  });

  return (
    <>
      <EmbedChromeCollapse />
      <main className="w-full flex-1 px-3 py-4">
        {/* On paper the frame is the schedule's sheet alone (#2745). */}
        <SchedulePaperSheet
          shop={shop}
          shopSlug={shopSlug}
          rows={rows}
          lead={[zoneNote]}
          empty={t("schedule.noTrips")}
          locale={locale}
          t={t}
          now={now}
        />
        <div id="schedule">
          {rows.length > 0 ? (
            <WeekLedger rows={rows} listLabel={t("schedule.tripListLabel")} stickyTop="top-0" />
          ) : (
            // A blank iframe on a shop's own website says nothing at all.
            <EmptyState
              title={t("schedule.noTrips")}
              body={t(
                shop.contactPhone || shop.contactEmail
                  ? "schedule.noTripsPublic"
                  : "schedule.noTripsPublicNoPhone",
              )}
            />
          )}
        </div>
        <EmbedFooter
          hostCarriesCredit={credit === "host"}
          shopSlug={shopSlug}
          zoneNote={zoneNote}
          t={t}
        />
      </main>
    </>
  );
}
