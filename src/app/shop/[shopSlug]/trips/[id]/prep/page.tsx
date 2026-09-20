import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { buttonClass } from "@/components/ui/button";
import { getTripPrep } from "@/db/trips-prep";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { isPrepGrouping, type PrepGrouping } from "@/lib/dive-prep";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { TripCapacityBadge, TripPageHeader } from "../_components/TripPageHeader";
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
    /** Which grouping; anything unrecognised reads as the by-item default. */
    group?: string;
    /**
     * **Not part of this route's URL contract** — see the same field on the
     * manifest page. The paper day composes this page once per departure, and
     * without a prefix every `aria-labelledby` below the first one points at
     * the first departure's heading. Narrowed by `uuidParam`, so a hand-typed
     * value on this route changes nothing.
     */
    idPrefix?: string;
  }>;
}) {
  const { shopSlug, id: tripId } = await params;
  const { notice, group, idPrefix: requestedIdPrefix } = await searchParams;
  const idPrefix = uuidParam(requestedIdPrefix ?? "") ?? undefined;
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
  const prep = await getTripPrep(db, shop, tripId);
  if (!prep) notFound();
  const { trip } = prep;

  return (
    <>
      <FlashParams params={["notice"]} />
      <TripPageHeader
        boardHref={shopPath(shopSlug, "trips", tripId)}
        backLabel={t("trips.surfaces.trip")}
        trip={trip}
        locale={locale}
        timeZone={shop.timezone}
        badge={
          <TripCapacityBadge trip={trip} cancelledLabel={t("trips.detail.cancelledBadge")} t={t} />
        }
      />
      <PrepBody
        prep={prep}
        t={t}
        locale={locale}
        shopSlug={shopSlug}
        tripId={tripId}
        rentalItems={shop.rentalItems}
        notice={notice}
        grouping={grouping}
        cancelled={trip.status === "cancelled"}
        groupPath={shopPath(shopSlug, "trips", tripId, "prep")}
        emptyState={
          // The whole page's content region, so this one wears an h2 — and the
          // packing list can only become real once someone is on the boat,
          // which happens on the departure page.
          <EmptyState
            title={t("tripPrep.emptyHeading")}
            body={t("tripPrep.noDivers")}
            action={
              <Link
                href={shopPath(shopSlug, "trips", tripId)}
                className={buttonClass({ className: "mt-4" })}
              >
                {t("tripPrep.emptyAction")}
              </Link>
            }
          />
        }
        idPrefix={idPrefix}
      />
    </>
  );
}
