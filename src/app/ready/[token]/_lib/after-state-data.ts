import type { AfterStateProps } from "@/app/ready/[token]/_components/AfterState";
import type { AppDb } from "@/db/client";
import { nextDiveForBooking } from "@/db/next-dive";
import { MAX_RECAP_PHOTOS_PER_BOOKING, type RecapPageData } from "@/db/recap";
import { getRecapPulseForBooking } from "@/db/recap-pulses";
import { getReviewForBooking } from "@/db/reviews";
import { tipPresetsMajor } from "@/db/tips";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_CERT_LEVEL_KEYS, NEXT_DIVE_REASON_KEYS } from "@/i18n/next-dive-labels";
import { depthText, temperatureText } from "@/i18n/unit-labels";
import { nowDate } from "@/lib/clock";
import { formatOrdinal, formatRelativeDay, formatShortDate } from "@/lib/format";
import type { NextDivePick } from "@/lib/next-dive";
import type { PostcardImage } from "@/lib/postcard-image";
import { siteMarkFor } from "@/lib/site-mark";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { visitMilestone } from "@/lib/visit-milestones";

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
  /** `?review=`, `?photo=`, `?tip=`, `?pulse=`, straight off the URL and never trusted. */
  params: { review?: string; photo?: string; tip?: string; pulse?: string };
  actions: AfterStateProps["actions"];
}): Promise<AfterStateProps> {
  const { db, data, bookingId, locale, t, params, actions } = input;
  const { shop, trip } = data;
  const [ownReview, nextDeparture, ownPulse, nextDive] = await Promise.all([
    getReviewForBooking(db, bookingId),
    nextPublicDeparture(db, shop.id, locale, shop.timezone),
    getRecapPulseForBooking(db, bookingId),
    // **The three server-side-only fields on `RecapPageData` are read here and
    // nowhere else** (`trip.id`, `trip.courseId`, `personId` — see their own
    // note in src/db/recap.ts). They never reach `AfterStateProps`: this props
    // object names every field explicitly rather than spreading `data`, which
    // is what keeps a person uuid off a client-visible bearer-token page.
    nextDiveForBooking(db, {
      shopId: shop.id,
      personId: data.personId,
      justDivedTripId: trip.id,
      dayCourseId: trip.courseId,
      dayShoutout: data.shoutout,
      daySiteNames: data.sites.map((site) => site.name),
    }),
  ]);
  const when = formatShortDate(trip.startsAt, locale, shop.timezone);

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
    when,
    diverName: data.diverName,
    sites: data.sites,
    // Read once in `getRecapPageData`, beside the plan it is compared against,
    // so both routes rendering this surface get the same answer.
    diveRecord: data.diveRecord,
    fieldGuide: data.fieldGuide,
    observedSpecies: data.observedSpecies,
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
    ownPulse,
    params,
    nextDeparture,
    // Assembled here from the same worded facts `DiveRecord` renders, so the
    // picture a diver saves and the card they are looking at cannot disagree.
    // It carries no URL field of any kind — see `src/lib/postcard-image.ts`.
    postcard: postcardFor({ data, t, locale, when }),
    nextDive,
    nextDiveWorded: nextDive ? wordNextDive(nextDive, t, locale, shop.timezone) : null,
    actions,
  };
}

/**
 * The saved picture's own copy of the record — the same rows, in the same
 * order, worded once. `DiveRecord` renders these from the same `data`; building
 * them here rather than in the client component is what makes a picture that
 * disagrees with the screen impossible rather than unlikely.
 *
 * The dive-day line is the *face's* line, so a milestone visit exports its own
 * sentence ("First dive day") rather than the ordinary count — the same branch
 * the roundel takes on screen.
 */
function postcardFor(input: {
  data: RecapPageData;
  t: DiverTranslator;
  locale: string;
  when: string;
}): PostcardImage {
  const { data, t, locale, when } = input;
  const { shop, trip } = data;
  const milestone = visitMilestone(data.visitCount);
  const conditions = conditionsLine(data, t);
  const siteNames = data.diveRecord
    ? data.diveRecord.actualSiteNames
    : data.sites.map((site) => site.name);
  const facts: PostcardImage["facts"] = [
    { label: t("recap.diverLabel"), value: data.diverName },
    { label: t("recap.dateLabel"), value: when },
    ...(trip.boatName ? [{ label: t("recap.vesselLabel"), value: trip.boatName }] : []),
    ...(trip.crew.length > 0 ? [{ label: t("recap.crewLabel"), value: trip.crew.join(", ") }] : []),
    ...(siteNames.length > 0
      ? [{ label: t("recap.sitesLabel"), value: siteNames.join(", ") }]
      : []),
    ...(conditions ? [{ label: t("recap.conditionsOnTheDay"), value: conditions }] : []),
  ];
  return {
    shopName: shop.name,
    heading: t("recap.logbookHeading"),
    diveDayLine: milestone
      ? milestone === 1
        ? t("recap.milestoneStampFirst")
        : t("recap.milestoneStamp", { ordinal: formatOrdinal(milestone, locale) })
      : t("recap.diveDayNumber", { count: data.visitCount }),
    facts,
    // Filled in by `SavePostcard` from what the diver types, in their browser
    // and nowhere else (issue #1193).
    privateLine: null,
    recordedBy: t("recap.recordedBy", { shopName: shop.name }),
  };
}

/** The day's conditions as one line, or null when nothing was recorded. */
function conditionsLine(data: RecapPageData, t: DiverTranslator): string | null {
  const { shop, trip } = data;
  const parts = [
    trip.waterTemperatureC !== null
      ? `${t("recap.waterTemp")}: ${temperatureText(t, trip.waterTemperatureC, temperatureUnitFor(shop))}`
      : null,
    trip.visibilityMeters !== null
      ? `${t("trip.visibility")}: ${depthText(t, trip.visibilityMeters, shop.depthUnit)}`
      : null,
    trip.surfaceConditions ? `${t("trip.surface")}: ${trip.surfaceConditions}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The next dive's two sentences and its day, worded here because this module is
 * where every fact on this surface is worded. `NextDiveCard` renders strings and
 * picks none of them, so the reason a diver reads and the code the ranker
 * returned cannot drift apart at a call site.
 */
function wordNextDive(
  pick: NextDivePick,
  t: DiverTranslator,
  locale: string,
  timeZone: string,
): { when: string; reason: string; levelCovers: string | null } {
  return {
    when: formatRelativeDay(pick.startsAt, nowDate(), locale, timeZone),
    reason: t(NEXT_DIVE_REASON_KEYS[pick.reason], {
      site: pick.reasonSite ?? "",
      course: pick.reasonCourse ?? "",
    }),
    levelCovers: pick.levelCovered
      ? t("recap.nextDiveLevelCovers", { level: t(DIVER_CERT_LEVEL_KEYS[pick.levelCovered]) })
      : null,
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
