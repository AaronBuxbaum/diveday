import type { Metadata } from "next";
import { shopBySlugCached } from "@/db/shops-cached";
import { requestLocale } from "@/i18n/request";
import { formatShortDate } from "@/lib/format";
import { publicTripPath } from "@/lib/public-routes";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";
import { uuidParam } from "@/lib/uuid";
import { publicTripRecord } from "./page-reads";

/**
 * The departure's own title, description, and canonical URL. Embed mode points
 * its canonical at this standalone page (docs ADR
 * 20260729-booking-page-structured-data).
 */
export async function publicTripMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}): Promise<Metadata> {
  const { shopSlug, id } = await params;
  // Metadata runs its own read, so it needs its own guard — and it must not
  // throw either: a junk id here would 500 the page before the body's
  // notFound() could render it.
  if (!uuidParam(id)) return { title: "Trip — DiveDay" };
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) return { title: "Trip — DiveDay" };
  const trip = await publicTripRecord(shop.id, id);
  if (!trip || trip.isRehearsal) return { title: "Trip — DiveDay" };
  const locale = await requestLocale(shop.defaultLocale);
  const when = formatShortDate(trip.startsAt, locale, shop.timezone);
  const title = `${trip.title} — ${when} · ${shop.name}`;
  const description =
    trip.description ??
    shop.description ??
    shop.tagline ??
    `Book ${trip.title} with ${shop.name} on ${when}.`;
  const canonical = publicTripPath(shop.slug, trip.id);
  return {
    title,
    description,
    alternates: { canonical },
    robots: shopSearchListingRobots(shop),
    openGraph: {
      ...openGraphSite,
      title,
      description,
      url: canonical,
    },
  };
}
