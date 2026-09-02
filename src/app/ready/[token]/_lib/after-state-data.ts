import type { AfterStateProps } from "@/app/ready/[token]/_components/AfterState";
import type { AppDb } from "@/db/client";
import { MAX_RECAP_PHOTOS_PER_BOOKING, type RecapPageData } from "@/db/recap";
import { getReviewForBooking } from "@/db/reviews";
import { tipPresetsMajor } from "@/db/tips";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { formatRelativeDay, formatShortDate } from "@/lib/format";
import { siteMarkFor } from "@/lib/site-mark";
import { temperatureUnitFor } from "@/lib/temperature-units";

/**
 * **One reading of the day, for two URLs** — ADR 20260827-the-divers-thread,
 * decision 4 (slice 7d).
 *
 * `/ready/[token]` after the boat is home and `/recap/[token]` render the same
 * `AfterState`, so the props it takes are assembled once, here, rather than
 * twice with two chances to drift. Both routes arrive holding the same
 * `getRecapPageData` result and their own bound actions; everything else the
 * surface needs — the diver's own review, the tip presets, the shop's next
 * public departure, the formatted date — is read and worded in this one place.
 *
 * It is deliberately the *recap* reader on both routes rather than a second
 * projection off `ReadyPageData`: the after-state's whole content is the day
 * that happened, and a second query shape for it is a second answer to "what
 * did I dive" waiting to disagree with the first.
 */
export async function buildAfterStateProps(input: {
  db: AppDb;
  data: RecapPageData;
  bookingId: string;
  /** The negotiated request locale — never the shop's own default. */
  locale: string;
  t: DiverTranslator;
  /** `?review=`, `?photo=`, `?tip=`, straight off the URL and never trusted. */
  params: { review?: string; photo?: string; tip?: string };
  actions: AfterStateProps["actions"];
}): Promise<AfterStateProps> {
  const { db, data, bookingId, locale, t, params, actions } = input;
  const { shop, trip } = data;
  const [ownReview, nextDeparture] = await Promise.all([
    getReviewForBooking(db, bookingId),
    nextPublicDeparture(db, shop.id, locale, shop.timezone),
  ]);

  return {
    t,
    locale,
    shop: {
      name: shop.name,
      slug: shop.slug,
      depthUnit: shop.depthUnit,
      // Stored metric, read in the units the shop actually works in — a shop
      // publishing feet may still read Celsius (src/lib/temperature-units.ts).
      temperatureUnit: temperatureUnitFor(shop),
      reviewUrl: shop.reviewUrl,
      brandColor: shop.brandColor,
      brandDisplayFont: shop.brandDisplayFont,
    },
    trip,
    // The postcard's drawing: the first site the day dived, read the way the
    // home spine reads a departure's (`siteMarkFor`), or the sea fan for a
    // course session whatever the site.
    siteMark: siteMarkFor({
      siteName: data.sites[0]?.name ?? null,
      isCourse: trip.courseTitle !== null,
    }),
    when: formatShortDate(trip.startsAt, locale, shop.timezone),
    diverName: data.diverName,
    sites: data.sites,
    // Read once in `getRecapPageData`, beside the plan it is compared against,
    // so both routes rendering this surface get the same answer.
    diveRecord: data.diveRecord,
    shoutout: data.shoutout,
    photos: data.photos,
    maxPhotos: MAX_RECAP_PHOTOS_PER_BOOKING,
    visitCount: data.visitCount,
    // The shop's declared currency (ADR 20260731-shop-currency), so a tip is
    // denominated the same way the trip the diver paid for was. The presets
    // are scaled by the same table as the tip bounds, so a preset can never
    // sit below the minimum the action enforces (src/db/tips.ts).
    currency: data.currency,
    canTip: data.canTip,
    tip: data.tip,
    tipPresets: tipPresetsMajor(data.currency),
    ownReview: ownReview ? { rating: ownReview.rating, comment: ownReview.comment } : null,
    params,
    nextDeparture,
    actions,
  };
}

/**
 * The shop's next public departure, as one worded fact for the after-state's
 * footer: its title and the relative day ("tomorrow", "in 3 days").
 *
 * One row, `publicOnly`, and no crew, capacity or requirement reads behind it
 * — this is a way back to the schedule, not a second storefront. Null when the
 * board is empty, which renders the bare "See what's next" link rather than an
 * invented sentence.
 */
export async function nextPublicDeparture(
  db: AppDb,
  shopId: string,
  locale: string,
  timeZone: string,
): Promise<{ title: string; when: string } | null> {
  const { trips } = await pagedUpcomingTripsWithCounts(db, shopId, { limit: 1, publicOnly: true });
  const next = trips[0];
  if (!next) return null;
  return {
    title: next.title,
    when: formatRelativeDay(next.startsAt, nowDate(), locale, timeZone),
  };
}
