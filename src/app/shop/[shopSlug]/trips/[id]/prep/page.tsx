import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { buttonClass } from "@/components/ui/button";
import { getTripPrepPage } from "@/db/trip-prep";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { isPrepGrouping, type PrepGrouping } from "@/lib/dive-prep";
import { PREP_SECTION_ID } from "@/lib/element-id";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { TripCapacityBadge, TripPageHeader } from "../_components/TripPageHeader";
import { TripStageBadge, TripTabs } from "../_components/TripTabs";
import { tripTabsCopy } from "../_components/trip-tabs-copy";
import { PrepBody } from "./_components/PrepBody";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Trip prep — DiveDay",
};

/**
 * The morning packing list. Everything above the assignments section is
 * derived from the roster's rental fits and the trip's dive plan — the
 * counts and sizes reserve nothing. The one exception is deliberate: a shop
 * that keeps its fleet on the gear register can assign tagged units to
 * renting divers here, and only that act reserves anything (ADR
 * 20260815-minimal-gear-register; a shop with no register sees no change).
 * It is a page to work down with your hands full, so it prints, and the two
 * ways it can be wrong (a missing fit, an unverified nitrox card) are stated
 * at the top rather than buried.
 *
 * The packing list itself is read two ways, chosen by `?group=` and resolved
 * server-side: down the rack (`item`, the default — six BCDs together with
 * their sizes) or down the roster (`diver` — one row per person with their
 * pieces). Both are the same pieces out of one `buildDivePrepChecklist` call,
 * so the choice is a sort rather than a second source of truth, and it lives
 * in the URL so a link to it survives being shared with whoever is loading
 * the van (same shape as the shop home's `?view=`).
 */
export default async function TripPrepPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{
    notice?: string;
    /** The number a counted gear notice names (`noticeCountParam`). */
    count?: string;
    /** Which grouping; anything unrecognised reads as the by-item default. */
    group?: string;
  }>;
}) {
  const { shopSlug, id: tripId } = await params;
  const { notice, count, group } = await searchParams;
  const grouping: PrepGrouping = isPrepGrouping(group) ? group : "item";
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { db, shop } = await requireShopSurface(shopSlug);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // The reader this tab shares with the packet's packing-list sheet: the
  // packing list, the crew's word for the header chip, whether the boat has
  // left the dock, and (once home) every unit still out on this boat.
  const view = await getTripPrepPage(db, shop, tripId, nowDate());
  if (!view) notFound();
  const { prep, shownStage, sailed, finished, backFromBoat } = view;
  const { trip } = prep;

  const body = (
    <PrepBody
      prep={prep}
      t={t}
      locale={locale}
      shopSlug={shopSlug}
      tripId={tripId}
      rentalItems={shop.rentalItems}
      notice={notice}
      noticeCount={count}
      grouping={grouping}
      cancelled={trip.status === "cancelled"}
      sailed={sailed}
      home={finished}
      backFromBoat={backFromBoat}
      groupPath={shopPath(shopSlug, "trips", tripId, "prep")}
      emptyState={
        <EmptyState
          title={t("tripPrep.emptyHeading")}
          body={t("tripPrep.noDivers")}
          action={
            <Link
              href={shopPath(shopSlug, "trips", tripId)}
              className={buttonClass({ className: "print:hidden" })}
            >
              {t("tripPrep.emptyAction")}
            </Link>
          }
        />
      }
      className="space-y-10"
    />
  );

  return (
    <>
      <FlashParams params={["notice", "count"]} />
      <TripPageHeader
        backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
        trip={trip}
        locale={locale}
        timeZone={shop.timezone}
        badge={
          <>
            <TripStageBadge stage={shownStage?.stage ?? null} copy={tripTabsCopy(t)} />
            <TripCapacityBadge
              trip={trip}
              finished={sailed}
              cancelledLabel={t("trips.detail.cancelledBadge")}
              t={t}
            />
          </>
        }
      />
      <TripTabs shopSlug={shopSlug} tripId={tripId} current="gear" copy={tripTabsCopy(t)} />
      {/* The anchor every "fix the packing list" link lands on. */}
      <div id={PREP_SECTION_ID} className="mt-10 scroll-mt-6">
        {body}
      </div>
    </>
  );
}
