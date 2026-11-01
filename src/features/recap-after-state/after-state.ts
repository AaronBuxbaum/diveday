import type { ReactNode } from "react";
import { issueBookingHandoff } from "@/db/booking-handoff";
import type { AppDb } from "@/db/client";
import { type BookedDeparture, bookedDepartures, nextDiveForBooking } from "@/db/next-dive";
import {
  MAX_RECAP_PHOTOS_PER_BOOKING,
  type RecapPageData,
  type RecapPhotoView,
  type RecapSite,
} from "@/db/recap";
import { getRecapPulseForBooking, type RecapPulseCategory } from "@/db/recap-pulses";
import { getReviewForBooking } from "@/db/reviews";
import { tipPresetsMajor } from "@/db/tips";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_CERT_LEVEL_KEYS, NEXT_DIVE_REASON_KEYS } from "@/i18n/next-dive-labels";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { depthText, temperatureText } from "@/i18n/unit-labels";
import { handoffHref } from "@/lib/booking-handoff";
import type { BrandDisplayFontCode } from "@/lib/brand";
import { BUDDY_PARAM } from "@/lib/buddy-links";
import { buddyReferralId } from "@/lib/buddy-tokens";
import { nowDate } from "@/lib/clock";
import type { DepthUnit } from "@/lib/depth-units";
import type { DiveRecordComparison } from "@/lib/dive-record";
import type { FlySafeAnchor, FlySafeReason } from "@/lib/fly-safe";
import {
  formatOrdinal,
  formatRelativeDay,
  formatShortDate,
  formatTime,
  formatWeekdayTime,
} from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";
import type { NextDivePick } from "@/lib/next-dive";
import type { PostcardImage } from "@/lib/postcard-image";
import { publicSchedulePath, publicTripPath } from "@/lib/public-routes";
import { type SiteMarkCode, siteMarkFor } from "@/lib/site-mark";
import { type TemperatureUnit, temperatureUnitFor } from "@/lib/temperature-units";
import { visitMilestone } from "@/lib/visit-milestones";

/**
 * Everything `AfterState` (`src/app/ready/[token]/_components/AfterState.tsx`)
 * renders, assembled by {@link buildAfterStateProps} below. It lives beside its
 * one assembler so this module never reaches up into a route for its shape.
 */
export type AfterStateProps = {
  t: DiverTranslator;
  /** The negotiated request locale, for every figure and date on the page. */
  locale: string;
  shop: {
    name: string;
    slug: string;
    depthUnit: DepthUnit;
    temperatureUnit: TemperatureUnit;
    /** Where "take it to Google" goes, or null when the shop has set none. */
    reviewUrl: string | null;
    /**
     * The shop's brand, worn by this surface the way the storefront wears it
     * (ADR 20260901-diveday-reimagined, slice 13i). Null renders DiveDay's own.
     */
    brandColor: string | null;
    brandDisplayFont: BrandDisplayFontCode | null;
  };
  /** The day's site, drawn in the illustration hand on the record's face. */
  siteMark: SiteMarkCode;
  /**
   * `plannedDives` is deliberately not here. It is what a shop typed on the
   * trip row, not a count of dives this diver made, and the one place it was
   * read printed it as "{n} dives logged" on a page built to be signed
   * (see `DiveRecord`).
   */
  trip: Pick<
    RecapPageData["trip"],
    "title" | "waterTemperatureC" | "visibilityMeters" | "surfaceConditions" | "boatName" | "crew"
  >;
  /** The trip's date, already formatted in the shop's zone. */
  when: string;
  diverName: string;
  sites: RecapSite[];
  /**
   * Where the day went against where it meant to go, or null when it went to
   * plan — which is the ordinary answer and renders nothing extra at all
   * (issue #1191).
   */
  diveRecord: DiveRecordComparison | null;
  /**
   * When this diver may fly, already worded in the shop's zone
   * (`src/lib/fly-safe.ts`, issue #1425), or null when the record could not
   * say. `anchor` picks the sentence: the clock started at the last recorded
   * exit, or at the day's scheduled end. Informs, gates nothing.
   */
  flySafe: { when: string; hours: number; anchor: FlySafeAnchor; reason: FlySafeReason } | null;
  /**
   * Per site the day dived, the species that site's field guide names.
   *
   * **What the place may hold, never what this dive did.** The drawer this
   * feeds is future-tense and scoped to the site by construction (issue #1192),
   * and it stays that way now that a sighting can be recorded: `observedSpecies`
   * below is the other field, deliberately, because merging them would let the
   * shop's standing claim about a reef render as somebody's report of a day.
   */
  fieldGuide: { siteName: string; rows: { id: string; catalogSlug: string | null }[] }[];
  /**
   * **What the crew wrote down that they saw** — catalog slugs, in dive order,
   * deduped (issue #1190, delight report D30).
   *
   * Present only when somebody recorded it. Empty is the ordinary state and
   * renders nothing, which is the boundary: a species is never inferred from
   * the guide above, and a day where nothing stood out is just a day. The words
   * come from the same `marineLife.*` copy the guide uses, so this arrives in
   * the diver's own language whatever the crew was reading when they picked it.
   */
  observedSpecies: string[];
  /**
   * The course this departure taught, with what the shop recorded for it
   * (issues #1196, #1205). Null on an ordinary charter and then nothing about
   * courses renders — see `CourseAfterState` for the overclaim rule.
   */
  course: RecapPageData["course"];
  shoutout: string | null;
  photos: RecapPhotoView[];
  /** How many photos one booking may hold — `MAX_RECAP_PHOTOS_PER_BOOKING`. */
  maxPhotos: number;
  /** Whether the shop takes recap photos (Features); off, no photo door is drawn. */
  photosOn: boolean;
  /** Dive days with this shop, native bookings and imported visits merged. */
  visitCount: number;
  currency: ShopCurrency;
  /** A *new* tip may be started right now (the shop's Stripe account can take one). */
  canTip: boolean;
  tip: RecapPageData["tip"];
  /** Tip presets in major units, scaled by the same table as the tip bounds. */
  tipPresets: number[];
  /**
   * Whether the shop asks for a star rating at all (`shops.reviews_enabled`).
   * Off, the page has no review card, and the private note to the shop stands
   * on its own.
   */
  canReview: boolean;
  /** The diver's own review, when they have left one. */
  ownReview: { rating: number; comment: string | null } | null;
  /**
   * The diver's own private pulse, when they have left one — never a review and
   * never public (D40, issue #1200). Its presence is also what puts the way back
   * on screen.
   */
  ownPulse: { categories: RecapPulseCategory[]; note: string | null } | null;
  /**
   * `?review=`, `?photo=`, `?tip=` and `?pulse=`, straight off the URL. All four
   * are attacker-supplied and every read below goes through `noticeFromParam`,
   * never a bare lookup that walks the prototype.
   */
  params: { review?: string; photo?: string; tip?: string; pulse?: string };
  /**
   * The shop's next public departure, already worded ("Two-Tank Reef" ·
   * "tomorrow"). Null when the board is empty, which renders the bare link.
   */
  nextDeparture: { title: string; when: string } | null;
  /**
   * **The day's record as a picture** (issue #1081): the same worded facts the
   * card below renders, assembled in `buildAfterStateProps` so the export and
   * the screen cannot disagree. It carries **no URL, token or slug** — that
   * absence is the whole reason this surface exports an image rather than
   * offering a share link (see this component's own note, and
   * `src/lib/postcard-image.ts`).
   */
  postcard: PostcardImage;
  /**
   * The one departure this diver is pointed at, or null when the board has
   * nothing for them (D35, issue #1195). Every candidate has already been
   * through `decideTripAdmission`, so the card can never suggest a boat they
   * could not board.
   */
  nextDive: NextDivePick | null;
  /** That pick's sentences, worded where every other fact on this page is worded. */
  nextDiveWorded: { when: string; reason: string; levelCovers: string | null } | null;
  /** The pick's booking page carrying this diver's own handoff, or null. */
  nextDiveHref?: string | null;
  /**
   * **The seat this diver already holds next**, worded, in place of a pick
   * (fifth-loop ideas, item 37): only a diver with nothing booked is offered a
   * new boat. Null on `/recap`, which is written to be forwarded, so a stranger
   * holding it is never told where the diver will be.
   */
  bookedNext?: { date: string; title: string; time: string } | null;
  /**
   * The diver's other days with the shop, as rows that each send a fresh link
   * (H-20261014-other-days-send-fresh). Rendered only on `/ready`; `/recap` passes nothing.
   */
  yourDays?: ReactNode;
  /**
   * **The buddy seat** (ADR 20260908-one-hand, decision 6, lever W): this
   * diver's own link to the shop, carrying a non-secret referral id, for them
   * to hand to a friend.
   *
   * Absolute, because the errand is to put it on a clipboard and send it
   * somewhere else — a path is not a link anybody can follow out of a message.
   * Null everywhere it does not belong: the readiness page renders this whole
   * component too, and "bring a buddy next time" is a thing to say after a dive
   * rather than before one.
   */
  buddyLinkUrl?: string | null;
  /**
   * Whether the photo door offers "Share with everyone on this boat". True
   * only from `/ready/<token>`, whose upload verifies the readiness token; the
   * recap link is forwardable for 180 days, so its photos stay on this recap
   * (security review of layer r5-4, F3).
   */
  canShareWithBoat: boolean;
  /** The recap actions, already bound to a signed recap token (the upload, on `/ready`, to its own). */
  actions: {
    submitReview: (formData: FormData) => void | Promise<void>;
    uploadPhoto: (formData: FormData) => void | Promise<void>;
    /** "Stop sharing" on the diver's own photo shared with the boat (#2806). */
    unsharePhoto: (formData: FormData) => void | Promise<void>;
    startTip: (formData: FormData) => void | Promise<void>;
    submitPulse: (formData: FormData) => void | Promise<void>;
  };
};

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
async function nextDiveHandoffHref(
  db: AppDb,
  shop: { id: string; slug: string },
  bookingId: string,
  tripId: string,
): Promise<string | null> {
  const issued = await issueBookingHandoff(db, { shopId: shop.id, bookingId });
  return issued ? handoffHref(publicTripPath(shop.slug, tripId), issued.token) : null;
}

/**
 * **The buddy seat** (ADR 20260908-one-hand, decision 6, lever W): the
 * recap's own link to the shop's schedule, carrying this booking's signed,
 * non-secret referral id, for the diver to hand to a friend.
 *
 * Null when the shop switched "Bring a buddy" off on Features (ADR
 * 20261005-optional-shop-features), and when no canonical origin is
 * configured: the errand is to send it to somebody, and a path nobody can
 * follow out of a message is no link.
 */
export function recapBuddyLinkUrl(
  shop: { slug: string; buddyLinksEnabled: boolean },
  bookingId: string,
  origin: string | null,
): string | null {
  if (!shop.buddyLinksEnabled || !origin) return null;
  const schedule = new URL(publicSchedulePath(shop.slug), `${origin}/`).toString();
  return `${schedule}?${BUDDY_PARAM}=${buddyReferralId(bookingId)}`;
}

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
  /**
   * Whether the next-dive link may carry a booking handoff (ADR
   * 20260906-before-you-ask, decision 3). True only from `/ready/<token>`,
   * whose capability is revocable and already discloses prep state. **Never
   * from `/recap/<token>`**: that link is signed for 180 days, cannot be
   * revoked, and is written to be forwarded — a handoff minted off it would
   * hand a diver's contact details to whoever the recap reached
   * (security review, 2026-09-06).
   */
  mintHandoff: boolean;
  /**
   * The link was mailed to the contact on file (`booking_capabilities.delivered`).
   * `/recap` passes false. Only a delivered `/ready` link reads or says
   * anything about the person's other bookings, or mints a handoff carrying
   * their gear: a booking or claim redirect proved only a typed name and an
   * address (security review r5-4, second pass, FIX 1).
   */
  delivered: boolean;
}): Promise<AfterStateProps> {
  const { db, data, bookingId, locale, t, params, actions } = input;
  const personWide = input.mintHandoff && input.delivered;
  const { shop, trip } = data;
  // On a delivered `/ready` link alone: a diver who already holds a later seat
  // is offered nothing new (item 37) and is told which seat it is. Anywhere
  // else the card does not depend on it. One read, beside the pick, for both.
  const bookedRead = personWide
    ? bookedDepartures(db, {
        shopId: shop.id,
        personId: data.personId,
        now: nowDate(),
        excludeTripId: trip.id,
      })
    : Promise.resolve<BookedDeparture[]>([]);
  const [ownReview, nextDeparture, ownPulse, nextDive, booked] = await Promise.all([
    getReviewForBooking(db, bookingId),
    nextPublicDeparture(db, shop.id, locale, shop.timezone),
    getRecapPulseForBooking(db, bookingId),
    // **The four server-side-only fields on `RecapPageData` are read here and
    // nowhere else** (`trip.id`, `trip.courseId`, `trip.lensId`, `personId` —
    // see their own
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
      dayLensId: trip.lensId,
      booked: bookedRead,
      noneIfBooked: true,
    }),
    bookedRead,
  ]);
  const [firstBooked] = booked;
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
    // Field by field, never `trip` itself: the recap's trip also carries the
    // server-side-only `id`, `courseId` and `lensId`, and the `Pick` in the
    // type does not strip them from the object.
    trip: {
      title: trip.title,
      waterTemperatureC: trip.waterTemperatureC,
      visibilityMeters: trip.visibilityMeters,
      surfaceConditions: trip.surfaceConditions,
      boatName: trip.boatName,
      crew: trip.crew,
    },
    course: data.course,
    // The postcard's drawing: the first site the day dived, read the way the
    // home spine reads a departure's (`siteMarkFor`), or the sea fan for a
    // course session whatever the site.
    siteMark: siteMarkFor({
      siteName: data.sites[0]?.name ?? null,
      isCourse: data.course !== null,
    }),
    when,
    diverName: data.diverName,
    sites: data.sites,
    // Read once in `getRecapPageData`, beside the plan it is compared against,
    // so both routes rendering this surface get the same answer.
    diveRecord: data.diveRecord,
    // Worded here, in the shop's zone: the instant is the shop's to state and
    // the diver reads it against a flight in the same place they dived.
    flySafe: data.flySafe
      ? {
          when: formatWeekdayTime(data.flySafe.from, locale, shop.timezone),
          hours: data.flySafe.hours,
          anchor: data.flySafe.anchor,
          // Not cosmetic: it picks which sentence the diver reads, and two of
          // the routes state their reason — this card shows no dive count at
          // all (see `DiveRecord`), so neither a plan the diver did not dive
          // nor a day before this one can be read off the page.
          reason: data.flySafe.reason,
        }
      : null,
    fieldGuide: data.fieldGuide,
    observedSpecies: data.observedSpecies,
    shoutout: data.shoutout,
    photos: data.photos,
    maxPhotos: MAX_RECAP_PHOTOS_PER_BOOKING,
    photosOn: data.shop.diverPhotosEnabled,
    visitCount: data.visitCount,
    // The shop's declared currency (ADR 20260731-shop-currency), so a tip is
    // denominated the same way the trip the diver paid for was. The presets
    // are scaled by the same table as the tip bounds, so a preset can never
    // sit below the minimum the action enforces (src/db/tips.ts).
    currency: data.currency,
    canTip: data.canTip,
    tip: data.tip,
    tipPresets: tipPresetsMajor(data.currency),
    canReview: shop.reviewsEnabled,
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
    // The door remembers who opened it (ADR 20260906-before-you-ask, decision
    // 3): the next dive's link carries a ten-minute handoff minted from this
    // booking, so the page it opens arrives with this diver's facts folded.
    nextDiveHref:
      nextDive && personWide
        ? await nextDiveHandoffHref(db, shop, bookingId, nextDive.tripId)
        : null,
    bookedNext:
      firstBooked && personWide
        ? {
            date: formatShortDate(firstBooked.startsAt, locale, shop.timezone),
            title: firstBooked.title,
            time: formatTime(firstBooked.startsAt, locale, shop.timezone),
          }
        : null,
    // The readiness link's upload is the one that verifies a revocable token,
    // and shares only from a delivered one (second pass, N-a).
    canShareWithBoat: personWide,
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
    ...(data.course?.certification
      ? [
          {
            label: t("recap.certifiedLabel"),
            value: t(DIVER_CERTIFICATION_LEVEL_KEYS[data.course.certification.level]),
          },
        ]
      : []),
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
      lens: pick.reasonLens ?? "",
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
async function nextPublicDeparture(
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
