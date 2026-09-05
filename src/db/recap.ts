import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { diverTranslator } from "@/i18n/messages";
import { isStaff } from "@/lib/authz";
import type { BrandDisplayFontCode } from "@/lib/brand";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import type { CertificationLevel } from "@/lib/certification-levels";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { DepthUnit } from "@/lib/depth-units";
import { compareDiveRecord, type DiveRecordComparison } from "@/lib/dive-record";
import { type ShopCurrency, toShopCurrency } from "@/lib/money";
import {
  type Notification,
  type NotificationProvider,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import { type CourtesyProvider, sendCourtesyMessage } from "@/lib/notifications/courtesy";
import {
  type SmsProvider,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications/sms";
import type { CheckoutProvider } from "@/lib/payments/checkout";
import { mergeShopHistory, priorVisitStanding } from "@/lib/prior-visits";
import { recapLinkPath } from "@/lib/recap-links";
import { RECAP_AUTOMATIC_DELAY_HOURS, unpauseRecapAutoSendAt } from "@/lib/recap-schedule";
import { maySendNow } from "@/lib/send-window";
import type { TemperatureUnit } from "@/lib/temperature-units";
import { loadActiveStaffRoles } from "./authz";
import { getBoatForHistory } from "./boats";
import type { AppDb, DbExecutor } from "./client";
import { issuePersonCourtesyEmailUnsubscribeToken } from "./courtesy-email";
import { listSiteFieldGuides } from "./dive-sites";
import { listExecutedDives } from "./executed-dives";
import {
  notificationProviderForDb,
  recordNotificationDelivery,
  sendNotificationBatch,
} from "./notifications";
import {
  bookings,
  certifications,
  notificationDeliveries,
  people,
  priorVisits,
  recapPhotos,
  type Shop,
  shops,
  tripRecapPhotos,
  trips,
} from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { getLatestTipForBooking, refreshTipFromStripe } from "./tips";
import { getTripWithBooked, listTripDives } from "./trips";
import { tripCrewByTrip } from "./trips-crew";
import { liveTrip } from "./trips-live";
import { whatsAppProvidersForShops } from "./whatsapp-accounts";

/** A diver's own recap photo, as the recap page renders it. */
export type RecapPhotoView = { id: string; imageUrl: string; caption: string | null };

/**
 * The post-trip recap: one reading of the day per diver per trip, generated
 * from the same source-of-truth trip and dive-site data the staff and booking
 * surfaces use. This is brainstorm C's "word-of-mouth window, weaponized" — the
 * highest-leverage marketing moment a shop has is the hours after a great dive,
 * and today it's unused.
 *
 * Since slice 7d it is not a page of its own: it is the thread's **after-state**
 * (`src/app/ready/[token]/_components/AfterState.tsx`), which `/recap/[token]`
 * renders from its own signed booking token and `/ready/[token]` renders from
 * the diver's own readiness link once the day is over. `sendDueRecaps`
 * delivers the `/recap` link no earlier than four hours after the trip ends.
 */

/**
 * A site the day visited, as the recap names it — which is the name and
 * nothing else.
 *
 * It used to carry six more fields. `locationName`, `marineLife` and the two
 * forecast coordinates fed `RecapMap`, the stylized boat-track drawing slice
 * 7d deleted; `maxDepthMeters` and `depthRange` fed a depth line the same
 * slice's review pass took off the after-state, because a depth *performed* is
 * the diver's to write and a divemaster's to countersign rather than a
 * property of the reef. Both went dead where they were *rendered* rather than
 * where they were read, so nothing failed and the projection kept copying them
 * (issue #1120, H-49). `AfterState.test.tsx` now refuses a seventh at
 * compile time, beside the paragraph explaining why.
 */
export type RecapSite = {
  name: string;
};

export type RecapPageData = {
  shop: {
    /**
     * The shop this booking belongs to. Carried so the thread's after-state
     * can ask one more question of the same tenant — "what is your next public
     * departure?" — without re-resolving the shop from its slug (ADR
     * 20260827-the-divers-thread, decision 4).
     */
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    timezone: string;
    defaultLocale: string;
    contactEmail: string | null;
    contactPhone: string | null;
    /** Where a "leave us a review" link sends the diver, or null when the shop hasn't set one. */
    reviewUrl: string | null;
    /**
     * The shop's measurement settings, so the recap's conditions tiles read in
     * the units the shop actually works in (src/lib/depth-units.ts,
     * src/lib/temperature-units.ts). Two independent settings, not one — a
     * shop can publish feet and Celsius. Storage stays metric either way.
     */
    depthUnit: DepthUnit;
    temperatureUnit: TemperatureUnit;
    /**
     * The shop's brand, so the thread's after-state wears it the way the
     * storefront does — the recap is the shop's postcard (ADR
     * 20260901-diveday-reimagined, slice 13i). Null means DiveDay's own tokens.
     */
    brandColor: string | null;
    brandDisplayFont: BrandDisplayFontCode | null;
    /**
     * How this shop signs off a finished day, in its own words (issue #1212).
     * Read only where the crew wrote nothing of their own for this diver — a
     * standing sentence must never talk over one somebody wrote today.
     */
    signOffNote: string | null;
  };
  /**
   * **The course this departure taught, and what the shop recorded for it**
   * (issues #1196 and #1205). Null on an ordinary charter, which is most of
   * them, and then nothing about courses renders at all.
   *
   * `certification` is populated from exactly one shape of row — issued by
   * this shop, from *this* departure, and verified — and from nothing else.
   * A self-declared card, a pending one, an imported one, and a verified one
   * issued from another trip all leave it null, and the recap then says
   * plainly that no certification was recorded rather than implying one.
   */
  course: {
    title: string;
    nextStep: { words: string; byName: string } | null;
    certification: { level: CertificationLevel; issuedAt: Date } | null;
  } | null;
  trip: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    plannedDives: number;
    waterTemperatureC: number | null;
    visibilityMeters: number | null;
    surfaceConditions: string | null;
    boatName: string | null;
    crew: string[];
  };
  diverName: string;
  sites: RecapSite[];
  /**
   * Where the day went against where it meant to go, or **null** when it went
   * to plan — which is the ordinary answer and renders nothing at all.
   *
   * `sites` above is the published plan and stays that way; this is the only
   * thing on the page that has read `executed_dives`. See
   * `src/lib/dive-record.ts` for what counts as a difference (issue #1191).
   */
  diveRecord: DiveRecordComparison | null;
  /**
   * Per site the day dived, the species that site's field guide names — in the
   * shop's saved order, and only for sites that have one.
   *
   * Slugs, not words: `fieldGuideCards` turns them into copy in the reader's
   * own language at render (ADR 20260813-marine-life-is-diveday-copy). These
   * are what a site *may* hold, never what this dive did (issue #1192).
   */
  fieldGuide: { siteName: string; rows: { id: string; catalogSlug: string | null }[] }[];
  /**
   * **What the crew actually saw**, in dive order, deduped — the other half of
   * the sentence `fieldGuide` starts (issue #1190, delight report D30).
   *
   * The two draw from the same catalog and mean opposite things: one is the
   * shop's standing claim about a reef, this is a person saying they saw it,
   * once, on this day. Empty is the ordinary state and renders nothing. Nothing
   * here is ever inferred from the guide above — that inference is exactly what
   * D30's boundary rules out, and it is why they are separate fields rather
   * than one field with a flag.
   */
  observedSpecies: string[];
  /** The booking this recap belongs to — the scope an uploaded photo attaches to. */
  bookingId: string;
  /** A short crew-authored note for this trip, or null when the crew wrote none. */
  shoutout: string | null;
  /** The diver's own uploaded photos, newest first. */
  photos: RecapPhotoView[];
  /** True when the shop's own Stripe account can take a tip charge right now. */
  canTip: boolean;
  /**
   * The shop's own currency (`shops.currency`, e.g. "usd"), for the tip
   * presets' label/symbol. Task 60 read the connected Stripe account's
   * `default_currency` here; task 35 moved it to the shop setting so the tip
   * is quoted in the same currency as the trip the diver just paid for
   * (docs ADR 20260731-shop-currency).
   */
  currency: ShopCurrency;
  /** The most recent tip attempt for this booking, if any — drives the tip panel's state. */
  tip: {
    status: "pending" | "paid" | "expired";
    amountCents: number;
    checkoutUrl: string | null;
  } | null;
  /** How many dive days this diver has with this shop, merging native bookings and imported visits. */
  visitCount: number;
};

/** How many photos one booking may attach — a memory strip, not a media host. */
export const MAX_RECAP_PHOTOS_PER_BOOKING = 12;

/** A close-out album is a memory strip, not a general-purpose media library. */
export const MAX_CREW_RECAP_PHOTOS_PER_TRIP = 24;

/**
 * Server-side caption bound. The upload form caps at this length client-side, but
 * the endpoint is public (token-auth), so the real cap lives here: an untrusted
 * caller's caption is truncated, never stored unbounded.
 */
export const MAX_RECAP_CAPTION_LENGTH = 140;

/**
 * The shop behind a dead recap link — its own published name and the contact
 * details it already publishes, and nothing else.
 */
export type DeadRecapShop = Pick<
  Shop,
  "name" | "slug" | "contactEmail" | "contactPhone" | "defaultLocale"
>;

export type RecapPageState =
  /** There is a recap to read: the thread's after-state. */
  | { kind: "recap"; data: RecapPageData }
  /**
   * The departure was called off and this seat was never cancelled — the
   * blow-out shape, where `callTripBlowout` cancels the trip and leaves every
   * booking active because whether each seat is refunded stays a per-booking
   * staff decision.
   */
  | { kind: "departure-cancelled"; shop: DeadRecapShop }
  /** Dead, but ours: the booking tier — name the shop, offer its hand. */
  | { kind: "dead"; shop: DeadRecapShop }
  /** The token parsed and resolved no booking at all: name nobody. */
  | { kind: "unknown" };

/**
 * **What `/recap/[token]` renders, once its signature has verified.**
 *
 * A recap token is *signed* rather than stored, so unlike the other three
 * booking capabilities there is no row to look up and no revocation — which is
 * exactly why the page used to collapse every dead cause into one bare notice
 * that named nobody. What that collapse was protecting against is a forged
 * token, and `verifyRecapToken` already rejects one before this function is
 * reachable: everything that gets here carries a signature DiveDay itself
 * wrote. So the split is the same one the other three booking tokens make (ADR
 * 20260827-first-light, decision 3) — a *verified* holder is a real diver on a
 * real booking and is owed the shop's name and its hand; an unverified one
 * never reaches this code.
 *
 * **What stays collapsed.** A cancelled booking and a no-show still get the
 * one sentence between them, so the failure state itself never says which
 * happened. What is split out is the *departure's* cancellation, which is not
 * a fact about the diver at all: their trip stopped running, the shop took it
 * off its public board, and "ask your dive shop for a fresh link" is advice
 * that cannot help them because no fresher link will ever exist. `/ready`
 * already says exactly this to the same diver, in the same words.
 */
export async function getRecapPageState(
  db: AppDb,
  bookingId: string,
  checkoutProvider?: CheckoutProvider,
): Promise<RecapPageState> {
  const data = await getRecapPageData(db, bookingId, checkoutProvider);
  if (data) return { kind: "recap", data };

  const [row] = await db
    .select({
      name: shops.name,
      slug: shops.slug,
      contactEmail: shops.contactEmail,
      contactPhone: shops.contactPhone,
      defaultLocale: shops.defaultLocale,
      bookingStatus: bookings.status,
      tripStatus: trips.status,
    })
    .from(bookings)
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.id, bookingId), liveTrip()))
    .limit(1);
  if (!row) return { kind: "unknown" };

  const { bookingStatus, tripStatus, ...shop } = row;
  // **The booking tier wins first, and by name rather than by a negation.**
  // Written as `bookingStatus !== "cancelled" && tripStatus === "cancelled"`
  // it read correctly and behaved otherwise: a `no_show` on a called-off
  // departure is not `"cancelled"`, so it took the departure branch — and a
  // bearer who could see the trip had left the shop's public board could then
  // tell a cancelled seat from a no-show by which card rendered, which is the
  // one distinction the paragraph above promises never to make. Nothing in the
  // product writes `no_show` yet (`src/db/today.ts`), so it was latent; the
  // day an action does write one it would have shipped working (`security-reviewer`,
  // on issue #1119).
  if (bookingStatus === "cancelled" || bookingStatus === "no_show") return { kind: "dead", shop };
  if (tripStatus === "cancelled") return { kind: "departure-cancelled", shop };
  // An active booking on a live departure that `getRecapPageData` still nulled
  // — no path reaches it today. The booking tier is the honest fallback: it
  // says the least of the three.
  return { kind: "dead", shop };
}

/**
 * Everything the recap page renders for one booking, or null when there was no
 * day to look back on. Sites are de-duplicated by name in dive order, so a
 * two-tank day on one site reads as one site, not two.
 *
 * **Three ways there is no day**, and the third was missing until a review
 * caught it (2026-08-28). A **cancelled booking** never held a seat and a
 * **no-show** never boarded; both have been refused here since the surface
 * existed. A **cancelled departure** is the third, and it is the one nothing
 * downstream catches: `callTripBlowout` sets `trips.status = 'cancelled'` and
 * deliberately leaves every booking active, because whether each seat is
 * refunded stays a per-booking staff decision (src/db/blowouts.ts), and
 * `getTripWithBooked` filters `liveTrip()` — the soft-delete predicate — not
 * the status. So on the afternoon a captain called it off, the divers who
 * drove to the dock and were sent home still held an active booking on an
 * ended trip, and this reader handed their page a boat, a crew, a dive count
 * and a tip ask.
 *
 * The recap *email* never had that bug: `sendRecaps` filters
 * `eq(trips.status, "scheduled")`. Folding the surface onto the readiness link
 * removed the only guard, so the guard moves here — one answer to "was there a
 * day" for the send path and both reading paths alike.
 */
export async function getRecapPageData(
  db: AppDb,
  bookingId: string,
  checkoutProvider?: CheckoutProvider,
): Promise<RecapPageData | null> {
  const [row] = await db
    .select({
      shopId: bookings.shopId,
      tripId: bookings.tripId,
      personId: bookings.personId,
      status: bookings.status,
      diverName: people.fullName,
      diverEmail: people.email,
      shopName: shops.name,
      slug: shops.slug,
      logoUrl: shops.logoUrl,
      timezone: shops.timezone,
      defaultLocale: shops.defaultLocale,
      contactEmail: shops.contactEmail,
      contactPhone: shops.contactPhone,
      reviewUrl: shops.reviewUrl,
      currency: shops.currency,
      depthUnit: shops.depthUnit,
      temperatureUnit: shops.temperatureUnit,
      brandColor: shops.brandColor,
      brandDisplayFont: shops.brandDisplayFont,
      signOffNote: shops.signOffNote,
      courseNextStep: bookings.courseNextStep,
      courseNextStepByPersonId: bookings.courseNextStepByPersonId,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  // A no-show never dived — showing them "here's what you dived" content
  // (or the tip/review asks that ride the same page) would be dishonest
  // regardless of how they reached the link. Same fail-closed-uniformly
  // notice as a cancelled booking gets, so a link's failure state never
  // itself discloses which of the two happened (Codex finding: the earlier
  // no-show fix only gated canTip/reviewUrl here, not the page itself).
  if (!row || row.status === "cancelled" || row.status === "no_show") return null;

  const trip = await getTripWithBooked(db, row.shopId, row.tripId);
  if (!trip) return null;
  // The departure itself was called off. Read the doc comment above before
  // relaxing this: an active booking on a cancelled trip is the *normal*
  // shape of a blow-out, not an inconsistency to tolerate.
  if (trip.status !== "scheduled") return null;

  const [
    dives,
    livedDives,
    boat,
    crewMap,
    nativeBookings,
    priorVisitRows,
    photos,
    stripeAccount,
    latestTip,
    sessionCertifications,
    nextStepAuthors,
  ] = await Promise.all([
    listTripDives(db, row.shopId, row.tripId),
    // The only read of `executed_dives` on this page. `listExecutedDives`
    // already drops soft-deleted rows and non-live trips, which is what keeps
    // a deleted dive off a diver's keepsake.
    listExecutedDives(db, row.shopId, row.tripId),
    trip.boatId ? getBoatForHistory(db, row.shopId, trip.boatId) : Promise.resolve(null),
    tripCrewByTrip(db, row.shopId, [row.tripId]),
    db
      .select({
        id: bookings.id,
        startsAt: trips.startsAt,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.shopId, row.shopId),
          eq(bookings.personId, row.personId),
          ne(bookings.status, "cancelled"),
          ne(bookings.status, "no_show"),
          // **A blown-out departure is not a dive day.** A cancellation
          // leaves its bookings active by design, so without this the count
          // includes days nobody dived — and the imported half of the same
          // merge already refuses exactly that (`priorVisitStanding(...) !==
          // "did_not_happen"`, below). `visitMilestone` is exact equality on
          // {1, 10, 25, 50, 100}, so one phantom day does not blur a
          // milestone, it skips it permanently: a first-timer whose first
          // trip blew out and who rebooked would reach their real first dive
          // counted as their second, and never see the "First dive day"
          // stamp at all.
          eq(trips.status, "scheduled"),
          liveTrip(),
          lte(trips.startsAt, trip.startsAt),
        ),
      ),
    db
      .select({
        id: priorVisits.id,
        visitedOn: priorVisits.visitedOn,
        statusLabel: priorVisits.statusLabel,
      })
      .from(priorVisits)
      .where(and(eq(priorVisits.shopId, row.shopId), eq(priorVisits.personId, row.personId))),
    listRecapPhotosForBooking(db, bookingId, row.tripId),
    getShopStripeAccount(db, row.shopId),
    getLatestTipForBooking(db, row.shopId, bookingId),
    // **The overclaim guard, as a query** (issues #1196, #1205). Three
    // conditions, and a card missing any one of them is not this session's
    // credential: the shop issued it (`issuedByShopAt`), it issued it *from
    // this departure* (`issuedFromTripId`), and it stands as verified. A
    // self-declaration, a pending review, an imported card and a card from
    // another session all read as "nothing was recorded", which is what the
    // recap then says out loud.
    trip.course
      ? db
          .select({ level: certifications.level, issuedAt: certifications.issuedByShopAt })
          .from(certifications)
          .where(
            and(
              eq(certifications.shopId, row.shopId),
              eq(certifications.personId, row.personId),
              eq(certifications.issuedFromTripId, row.tripId),
              isNotNull(certifications.issuedByShopAt),
              eq(certifications.status, "verified"),
              isNull(certifications.deletedAt),
            ),
          )
          .orderBy(desc(certifications.issuedByShopAt))
          .limit(1)
      : Promise.resolve([]),
    // Who wrote the next step, for the name under the words. Read only when
    // there are words: an author with nothing under it renders nothing.
    row.courseNextStep && row.courseNextStepByPersonId
      ? db
          .select({ fullName: people.fullName })
          .from(people)
          .where(eq(people.id, row.courseNextStepByPersonId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const sites: RecapSite[] = [];
  const seen = new Set<string>();
  for (const { diveSite } of dives) {
    if (!diveSite || seen.has(diveSite.name)) continue;
    seen.add(diveSite.name);
    sites.push({ name: diveSite.name });
  }

  // Sites only: this card prints no depth, time or condition of a dive
  // *performed* — those are the diver's to write and a divemaster's to
  // countersign (see `DiveRecord`'s comment). That is also why
  // `executed_dives.not_recorded` needs no handling here; nothing reaches past
  // the site name.
  // One query for the whole day. Grouped per site rather than pooled, because
  // the drawer names the site above each set of faces — which is what keeps the
  // guide a statement about a *place* rather than about this dive (#1192).
  const guides = await listSiteFieldGuides(
    db,
    row.shopId,
    dives.flatMap(({ diveSite }) => (diveSite ? [diveSite.id] : [])),
  );
  const namedSites = new Set<string>();
  const fieldGuide: RecapPageData["fieldGuide"] = [];
  for (const { diveSite } of dives) {
    if (!diveSite || namedSites.has(diveSite.id)) continue;
    namedSites.add(diveSite.id);
    const rows = guides.get(diveSite.id);
    if (!rows?.length) continue;
    fieldGuide.push({
      siteName: diveSite.name,
      rows: rows.map((creature) => ({ id: creature.id, catalogSlug: creature.catalogSlug })),
    });
  }

  // In dive order, first mention wins. A day where both tanks turned up the
  // same turtle says "turtle" once: this is a keepsake line, not a tally.
  const observedSpecies: string[] = [];
  for (const { executed } of [...livedDives].sort(
    (a, b) => a.executed.diveNumber - b.executed.diveNumber,
  )) {
    const slug = executed.observedSpeciesSlug;
    if (slug && !observedSpecies.includes(slug)) observedSpecies.push(slug);
  }

  const diveRecord = compareDiveRecord(
    dives.map(({ dive, diveSite }) => ({
      diveNumber: dive.diveNumber,
      siteName: diveSite?.name ?? null,
    })),
    livedDives.map(({ executed, actualSite }) => ({
      diveNumber: executed.diveNumber,
      siteName: actualSite?.name ?? null,
    })),
  );

  const tripLocalDay = calendarDateInTimezone(trip.startsAt, row.timezone);
  const effectivePriorVisits = priorVisitRows.filter(
    (v) => priorVisitStanding(v.statusLabel) !== "did_not_happen" && v.visitedOn <= tripLocalDay,
  );
  const mergedHistory = mergeShopHistory(nativeBookings, effectivePriorVisits, {
    bookingStartsAt: (b) => b.startsAt,
    visitedOn: (v) => v.visitedOn,
    timezone: row.timezone,
  });
  const visitCount = Math.max(1, mergedHistory.length);
  const crew = (crewMap.get(row.tripId) ?? []).map((c) => c.name);

  // A still-pending tip's local status is a lead, not proof — a delayed or
  // missed webhook must never leave the page offering a dead Checkout link,
  // or (via a bare `?tip=paid` return-URL) reading as confirmed when Stripe
  // itself hasn't said so.
  const tip =
    latestTip?.status === "pending"
      ? await refreshTipFromStripe(db, row.shopId, latestTip.id, checkoutProvider)
      : latestTip;

  const sessionCertification = sessionCertifications[0] ?? null;
  const nextStepWords = row.courseNextStep?.trim() || null;
  const nextStepAuthor = nextStepAuthors[0]?.fullName?.trim() || null;

  return {
    shop: {
      id: row.shopId,
      name: row.shopName,
      slug: row.slug,
      logoUrl: row.logoUrl,
      timezone: row.timezone,
      defaultLocale: row.defaultLocale,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      reviewUrl: row.reviewUrl,
      depthUnit: row.depthUnit,
      temperatureUnit: row.temperatureUnit,
      brandColor: row.brandColor,
      brandDisplayFont: row.brandDisplayFont,
      signOffNote: row.signOffNote,
    },
    course: trip.course
      ? {
          title: trip.course.title,
          nextStep:
            nextStepWords && nextStepAuthor
              ? { words: nextStepWords, byName: nextStepAuthor }
              : null,
          certification:
            sessionCertification?.issuedAt && sessionCertification.level
              ? { level: sessionCertification.level, issuedAt: sessionCertification.issuedAt }
              : null,
        }
      : null,
    trip: {
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      plannedDives: trip.plannedDives,
      waterTemperatureC: trip.waterTemperatureC,
      visibilityMeters: trip.visibilityMeters,
      surfaceConditions: trip.surfaceConditions,
      boatName: boat?.name ?? null,
      crew,
    },
    diverName: row.diverName,
    sites,
    diveRecord,
    fieldGuide,
    observedSpecies,
    bookingId,
    shoutout: trip.recapShoutout,
    photos,
    // A phone-only diver (a supported case — their recap can go out by SMS
    // instead) has nothing `startTipCheckout` can hand to Stripe as a
    // customer email; offering the form anyway would fail on every
    // submission (Codex finding).
    canTip: Boolean(row.diverEmail) && canAcceptPayments(stripeAccount),
    currency: toShopCurrency(row.currency),
    tip: tip
      ? {
          status: tip.status,
          amountCents: tip.amountCents,
          checkoutUrl: tip.checkoutUrl,
        }
      : null,
    visitCount,
  };
}

/** A diver's recap photos, including staff-shared departure photos, newest first. */
export async function listRecapPhotosForBooking(
  db: AppDb,
  bookingId: string,
  tripId?: string,
): Promise<RecapPhotoView[]> {
  const [diverRows, crewRows] = await Promise.all([
    db
      .select({
        id: recapPhotos.id,
        imageUrl: recapPhotos.imageUrl,
        caption: recapPhotos.caption,
        createdAt: recapPhotos.createdAt,
      })
      .from(recapPhotos)
      .where(eq(recapPhotos.bookingId, bookingId))
      .orderBy(desc(recapPhotos.createdAt)),
    tripId
      ? db
          .select({
            id: tripRecapPhotos.id,
            imageUrl: tripRecapPhotos.imageUrl,
            createdAt: tripRecapPhotos.createdAt,
          })
          .from(tripRecapPhotos)
          .where(eq(tripRecapPhotos.tripId, tripId))
          .orderBy(desc(tripRecapPhotos.createdAt))
      : Promise.resolve([]),
  ]);
  return [...diverRows, ...crewRows.map((photo) => ({ ...photo, caption: null }))]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(({ createdAt: _createdAt, ...photo }) => photo);
}

export type RecapPhotoEligibility =
  | { ok: true }
  | { ok: false; reason: "not_found" | "cancelled" | "limit" };

/**
 * Whether a booking may take another recap photo — the same booking/cancelled/cap
 * gate as `addRecapPhoto`, but read-only. The public upload action runs this
 * *before* writing bytes to blob storage, so a cancelled booking or one already
 * at its cap is rejected without an orphaned upload (a shared recap link is a
 * write capability — this bounds the expensive side effect, not just the row).
 *
 * `no_show` is refused the same way as `cancelled` (Codex finding), reported
 * under the same `"cancelled"` reason rather than a distinguishable one — a
 * no-show never dived either, and `getRecapPageData` already treats the two
 * identically (returns `null` for both) for the same fail-closed-uniformly
 * reason the rest of this token surface follows: a link's failure state must
 * never disclose *why* a booking is unreachable. Matters independently of
 * that page-level gate because a recap link can be bookmarked/reloaded from
 * before a staff correction — a form loaded while the booking still read
 * `booked` could otherwise still write photos into a no-show's gallery after
 * the fact.
 */
export async function canAddRecapPhoto(
  db: AppDb,
  bookingId: string,
): Promise<RecapPhotoEligibility> {
  const [booking] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: "not_found" };
  if (booking.status === "cancelled" || booking.status === "no_show") {
    return { ok: false, reason: "cancelled" };
  }
  const [{ count: existing } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recapPhotos)
    .where(eq(recapPhotos.bookingId, bookingId));
  if (existing >= MAX_RECAP_PHOTOS_PER_BOOKING) return { ok: false, reason: "limit" };
  return { ok: true };
}

export type AddRecapPhotoResult =
  | { ok: true; photo: RecapPhotoView }
  | { ok: false; reason: "not_found" | "cancelled" | "limit" };

/**
 * Attach a photo to a diver's recap. The booking is resolved and shop/trip are
 * derived from it (never trusted from the caller), a cancelled booking is
 * refused, and a booking already at its photo cap is refused rather than
 * silently dropped. The whole check-and-insert runs in one transaction that
 * locks the booking row `FOR UPDATE`, so the cap is enforced atomically: this is
 * a public token-auth endpoint, and without the lock two concurrent uploads on
 * the same booking could both read `count = cap-1` under READ COMMITTED and both
 * insert, blowing past the cap (and its 5 MB-per-blob cost bound). Mirrors the
 * booking-capacity lock in `bookings.ts`; PGlite is single-connection so tests
 * can't exhibit the race — the lock is for production Postgres. The caption is
 * truncated to a server bound. The image URL comes from the storage seam upstream.
 */
export async function addRecapPhoto(
  db: AppDb,
  input: { bookingId: string; imageUrl: string; caption?: string | null },
): Promise<AddRecapPhotoResult> {
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({ shopId: bookings.shopId, tripId: bookings.tripId, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1)
      .for("update");
    if (!booking) return { ok: false, reason: "not_found" };
    // Same no_show/cancelled treatment as canAddRecapPhoto above (Codex
    // finding) — the locked, insert-time check, not just the pre-storage one.
    if (booking.status === "cancelled" || booking.status === "no_show") {
      return { ok: false, reason: "cancelled" };
    }

    const [{ count: existing } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(recapPhotos)
      .where(eq(recapPhotos.bookingId, input.bookingId));
    if (existing >= MAX_RECAP_PHOTOS_PER_BOOKING) return { ok: false, reason: "limit" };

    const caption = input.caption?.trim().slice(0, MAX_RECAP_CAPTION_LENGTH) || null;
    const [photo] = await tx
      .insert(recapPhotos)
      .values({
        shopId: booking.shopId,
        bookingId: input.bookingId,
        tripId: booking.tripId,
        imageUrl: input.imageUrl,
        caption,
      })
      .returning({
        id: recapPhotos.id,
        imageUrl: recapPhotos.imageUrl,
        caption: recapPhotos.caption,
      });
    if (!photo) return { ok: false, reason: "not_found" };
    return { ok: true, photo };
  });
}

export type StaffRecapPhoto = RecapPhotoView & { diverName: string; bookingId: string };

/** Every diver photo on a trip, with who shared it — the staff moderation gallery. */
export async function listRecapPhotosForTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<StaffRecapPhoto[]> {
  return db
    .select({
      id: recapPhotos.id,
      imageUrl: recapPhotos.imageUrl,
      caption: recapPhotos.caption,
      diverName: people.fullName,
      bookingId: recapPhotos.bookingId,
    })
    .from(recapPhotos)
    .innerJoin(bookings, eq(bookings.id, recapPhotos.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(recapPhotos.shopId, shopId), eq(recapPhotos.tripId, tripId)))
    .orderBy(desc(recapPhotos.createdAt));
}

export type DeleteRecapPhotoResult = { deleted: true; imageUrl: string } | { deleted: false };

/**
 * Take a photo down — the moderation seam, shop-scoped. Returns the removed
 * row's URL so the caller can queue the blob object for deletion too
 * (CR-012) — this function only owns the row.
 */
export async function deleteRecapPhoto(
  db: AppDb,
  shopId: string,
  photoId: string,
): Promise<DeleteRecapPhotoResult> {
  const [removed] = await db
    .delete(recapPhotos)
    .where(and(eq(recapPhotos.id, photoId), eq(recapPhotos.shopId, shopId)))
    .returning({ imageUrl: recapPhotos.imageUrl });
  return removed ? { deleted: true, imageUrl: removed.imageUrl } : { deleted: false };
}

/** Staff photos taken on a departure, newest first. They are shared into each diver recap. */
export type CrewRecapPhoto = { id: string; imageUrl: string };

export type CrewRecapPhotoEligibility =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_ended" | "not_staff" | "limit" };

async function canStaffUploadCrewRecapPhoto(db: AppDb, shopId: string, personId: string) {
  const roles = await loadActiveStaffRoles(db, shopId, personId);
  return Boolean(roles && isStaff(roles));
}

/**
 * The pre-storage gate for a crew image. The upload action uses it before
 * bytes reach Blob storage, and `addCrewRecapPhoto` repeats it under a trip
 * lock to close the concurrent-upload race.
 */
export async function canAddCrewRecapPhoto(
  db: AppDb,
  input: { shopId: string; tripId: string; uploadedByPersonId: string; now?: Date },
): Promise<CrewRecapPhotoEligibility> {
  const now = input.now ?? nowDate();
  if (!(await canStaffUploadCrewRecapPhoto(db, input.shopId, input.uploadedByPersonId))) {
    return { ok: false, reason: "not_staff" };
  }
  const [trip] = await db
    .select({ endsAt: trips.endsAt, status: trips.status })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (trip?.status !== "scheduled") return { ok: false, reason: "not_found" };
  if (trip.endsAt > now) return { ok: false, reason: "not_ended" };
  const [{ count: existing } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tripRecapPhotos)
    .where(and(eq(tripRecapPhotos.shopId, input.shopId), eq(tripRecapPhotos.tripId, input.tripId)));
  return existing >= MAX_CREW_RECAP_PHOTOS_PER_TRIP ? { ok: false, reason: "limit" } : { ok: true };
}

export type AddCrewRecapPhotoResult =
  | { ok: true; photo: CrewRecapPhoto }
  | { ok: false; reason: "not_found" | "not_ended" | "not_staff" | "limit" };

/**
 * Attach a staff-owned image to one completed departure. The row has no
 * booking by design: one upload is shared into every diver recap for the
 * completed departure.
 */
export async function addCrewRecapPhoto(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    uploadedByPersonId: string;
    imageUrl: string;
    now?: Date;
  },
): Promise<AddCrewRecapPhotoResult> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    const roles = await loadActiveStaffRoles(tx, input.shopId, input.uploadedByPersonId);
    if (!roles || !isStaff(roles)) return { ok: false, reason: "not_staff" } as const;
    const [trip] = await tx
      .select({ endsAt: trips.endsAt, status: trips.status })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (trip?.status !== "scheduled") return { ok: false, reason: "not_found" } as const;
    if (trip.endsAt > now) return { ok: false, reason: "not_ended" } as const;
    if (await hasSentTripRecap(tx, input.shopId, input.tripId)) {
      return { ok: false, reason: "not_found" } as const;
    }
    const [{ count: existing } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(tripRecapPhotos)
      .where(
        and(eq(tripRecapPhotos.shopId, input.shopId), eq(tripRecapPhotos.tripId, input.tripId)),
      );
    if (existing >= MAX_CREW_RECAP_PHOTOS_PER_TRIP) return { ok: false, reason: "limit" } as const;
    const [photo] = await tx
      .insert(tripRecapPhotos)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        imageUrl: input.imageUrl,
        uploadedByPersonId: input.uploadedByPersonId,
      })
      .returning({ id: tripRecapPhotos.id, imageUrl: tripRecapPhotos.imageUrl });
    if (!photo) throw new Error("addCrewRecapPhoto: insert returned no row");
    return { ok: true, photo } as const;
  });
}

export async function listCrewRecapPhotosForTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<CrewRecapPhoto[]> {
  return db
    .select({ id: tripRecapPhotos.id, imageUrl: tripRecapPhotos.imageUrl })
    .from(tripRecapPhotos)
    .where(and(eq(tripRecapPhotos.shopId, shopId), eq(tripRecapPhotos.tripId, tripId)))
    .orderBy(desc(tripRecapPhotos.createdAt));
}

export type DeleteCrewRecapPhotoResult = { deleted: true; imageUrl: string } | { deleted: false };

/** A successful delivery freezes the close-out's shared recap content. */
export async function hasSentTripRecap(db: DbExecutor, shopId: string, tripId: string) {
  const rows = await db
    .select({
      bookingId: bookings.id,
      bookingStatus: bookings.status,
      deliveryStatus: notificationDeliveries.status,
    })
    .from(bookings)
    .leftJoin(
      notificationDeliveries,
      and(
        eq(notificationDeliveries.bookingId, bookings.id),
        eq(notificationDeliveries.shopId, shopId),
        eq(notificationDeliveries.kind, "trip_recap"),
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
        ne(bookings.status, "no_show"),
      ),
    );
  return rows.length > 0 && rows.every((row) => row.deliveryStatus === "sent");
}

/** Set (or clear, with an empty string) a trip's crew-authored recap shout-out. */
export async function setTripRecapShoutout(
  db: AppDb,
  shopId: string,
  tripId: string,
  shoutout: string,
): Promise<boolean> {
  if (await hasSentTripRecap(db, shopId, tripId)) return false;
  const [trip] = await db
    .update(trips)
    .set({ recapShoutout: shoutout.trim() || null })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .returning({ id: trips.id });
  return Boolean(trip);
}

/** Delete a shared close-out image and return its URL for tracked Blob cleanup. */
export async function deleteCrewRecapPhoto(
  db: AppDb,
  shopId: string,
  photoId: string,
): Promise<DeleteCrewRecapPhotoResult> {
  const [removed] = await db
    .delete(tripRecapPhotos)
    .where(and(eq(tripRecapPhotos.id, photoId), eq(tripRecapPhotos.shopId, shopId)))
    .returning({ imageUrl: tripRecapPhotos.imageUrl });
  return removed ? { deleted: true, imageUrl: removed.imageUrl } : { deleted: false };
}

/**
 * How far back a run looks for departed trips. The hourly recap scan catches a
 * trip on its first run after the four-hour floor; 48h leaves a full missed-run
 * of slack, and the once-per-booking `trip_recap` delivery row means an
 * overlapping window never double-sends (docs ADR 20260721-scheduled-reminder-cadence).
 */
export const RECAP_LOOKBACK_HOURS = 48;

export type RecapRunSummary = {
  /** Active bookings on trips that departed inside the lookback window. */
  scanned: number;
  /** Recaps whose tracked channel reported a real send. */
  sent: number;
  /** Bookings whose recap was already delivered. */
  skipped: number;
  /**
   * Recaps that were due and were held for the shop's civil hours
   * (`src/lib/send-window.ts`) — a four-hour delay after a night dive lands at
   * 3 AM. Counted apart from `skipped`: that one means "nothing to send", this
   * one means "something, waiting for morning".
   */
  held: number;
  /** Recaps whose tracked channel failed or was not configured. */
  failed: number;
  /** Divers who self-served out of courtesy email (`people.courtesyEmailOptOutAt`). */
  optedOut: number;
};

export type SendDueRecapsOptions = {
  now?: Date;
  emailProvider?: NotificationProvider;
  smsProvider?: SmsProvider;
  /**
   * Per-shop WhatsApp senders, keyed by shop id; defaults to whatever the
   * scanned shops have connected (docs ADR 20260802-whatsapp-cloud-api-per-shop).
   */
  whatsAppProviders?: Map<string, CourtesyProvider>;
  /** Origin for the recap link; defaults to the configured public app URL. */
  appOrigin?: string | null;
};

type RecapScanScope = { shopId?: string; tripId?: string };

/**
 * Pause automatic recap sending for a trip.
 */
export async function pauseTripRecapAutoSend(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<boolean> {
  const result = await db
    .update(trips)
    .set({ recapAutoSendPaused: true })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Unpause automatic recap sending for a trip.
 * Sets the new auto-send time to the later of (the original sending time, 1 hour after the unpause).
 */
export async function unpauseTripRecapAutoSend(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  unpausedAt: Date = nowDate(),
): Promise<{ ok: boolean; autoSendAt: Date | null }> {
  const [trip] = await db
    .select({ id: trips.id, endsAt: trips.endsAt, status: trips.status })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);

  if (trip?.status !== "scheduled") {
    return { ok: false, autoSendAt: null };
  }

  const nextAutoSendAt = unpauseRecapAutoSendAt(trip.endsAt, unpausedAt);
  await db
    .update(trips)
    .set({ recapAutoSendPaused: false, recapAutoSendAt: nextAutoSendAt })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)));

  return { ok: true, autoSendAt: nextAutoSendAt };
}

/**
 * A staff-triggered send can be initiated whenever staff wants on an ended departure.
 * Sending recaps creates delivery records, naturally stopping any future automatic send.
 */
export type SendTripRecapsResult =
  | { ok: true; summary: RecapRunSummary }
  | { ok: false; reason: "not_found" };

export async function sendTripRecaps(
  db: AppDb,
  input: { shopId: string; tripId: string; options?: SendDueRecapsOptions },
): Promise<SendTripRecapsResult> {
  const now = input.options?.now ?? nowDate();
  const [trip] = await db
    .select({ id: trips.id, endsAt: trips.endsAt, status: trips.status })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (trip?.status !== "scheduled") return { ok: false, reason: "not_found" };
  return {
    ok: true,
    summary: await sendRecaps(
      db,
      { ...input.options, now },
      { shopId: input.shopId, tripId: input.tripId },
    ),
  };
}

/**
 * Send the post-trip recap for every booking on a trip that departed within the
 * lookback window and hasn't been sent one yet. Idempotent by the same
 * one-row-per-(booking, kind) delivery dedup as the pre-trip reminders. The
 * recap link is the whole point, so a run with no resolvable app origin records
 * `not_configured` (surfaced on the staff dashboard) rather than sending a
 * dead-end email. Email is the tracked channel; a textable phone gets a
 * courtesy text on top — over the shop's own WhatsApp when it has connected
 * one, over platform SMS otherwise (`src/lib/notifications/courtesy.ts`).
 */
export async function sendDueRecaps(
  db: AppDb,
  options: SendDueRecapsOptions = {},
): Promise<RecapRunSummary> {
  return sendRecaps(db, options);
}

/** Shared dispatcher for the all-shop cron and a single eligible departure. */
async function sendRecaps(
  db: AppDb,
  options: SendDueRecapsOptions = {},
  scope: RecapScanScope = {},
): Promise<RecapRunSummary> {
  const now = options.now ?? nowDate();
  const emailProvider = notificationProviderForDb(options.emailProvider);
  const smsProvider = options.smsProvider ?? smsProviderFromEnvironment();
  const origin = options.appOrigin === undefined ? publicAppUrl() : options.appOrigin;
  const since = new Date(now.getTime() - RECAP_LOOKBACK_HOURS * HOUR_MS);
  const eligibleBefore = new Date(now.getTime() - RECAP_AUTOMATIC_DELAY_HOURS * HOUR_MS);

  const rows = await db
    .select({ booking: bookings, person: people, trip: trips, shop: shops })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(
      and(
        ne(bookings.status, "cancelled"),
        // A no-show never dived — sending "here's what you dived" (and the
        // tip/review asks that ride the same page) would be dishonest
        // (Codex finding).
        ne(bookings.status, "no_show"),
        eq(trips.status, "scheduled"),
        ...(scope.shopId ? [eq(trips.shopId, scope.shopId)] : []),
        ...(scope.tripId
          ? [eq(trips.id, scope.tripId)]
          : [
              eq(trips.recapAutoSendPaused, false),
              isNotNull(trips.endsAt),
              gt(trips.endsAt, since),
              or(
                and(isNotNull(trips.recapAutoSendAt), lte(trips.recapAutoSendAt, now)),
                and(isNull(trips.recapAutoSendAt), lte(trips.endsAt, eligibleBefore)),
              ),
            ]),
      ),
    );
  const summary: RecapRunSummary = {
    scanned: rows.length,
    sent: 0,
    skipped: 0,
    held: 0,
    failed: 0,
    optedOut: 0,
  };
  if (rows.length === 0) return summary;

  // One query for the whole scan rather than a lookup per booking.
  const whatsAppProviders =
    options.whatsAppProviders ??
    (await whatsAppProvidersForShops(
      db,
      rows.map((row) => row.shop.id),
    ));

  const bookingIds = rows.map((r) => r.booking.id);
  const delivered = await db
    .select({ bookingId: notificationDeliveries.bookingId })
    .from(notificationDeliveries)
    .where(
      and(
        inArray(notificationDeliveries.bookingId, bookingIds),
        eq(notificationDeliveries.kind, "trip_recap"),
        eq(notificationDeliveries.status, "sent"),
      ),
    );
  const alreadySent = new Set(delivered.map((d) => d.bookingId));

  // The sites dived, per trip, so each recap email can name the day. Fetched
  // once per distinct trip in the run rather than per booking, and all trips
  // resolved together rather than one round trip at a time.
  const siteNamesByTrip = new Map<string, string[]>();
  await Promise.all(
    [...new Set(rows.map((r) => r.trip.id))].map(async (tripId) => {
      const shopId = rows.find((r) => r.trip.id === tripId)?.shop.id;
      if (!shopId) return;
      const dives = await listTripDives(db, shopId, tripId);
      const names: string[] = [];
      for (const { diveSite } of dives) {
        if (diveSite && !names.includes(diveSite.name)) names.push(diveSite.name);
      }
      siteNamesByTrip.set(tripId, names);
    }),
  );

  const emailWork: Array<{
    bookingId: string;
    shopId: string;
    shopName: string;
    phone: string | null;
    smsBody: string;
    notification: Notification;
  }> = [];
  const smsWork: Array<{
    bookingId: string;
    shopId: string;
    shopName: string;
    phone: string;
    smsBody: string;
  }> = [];

  for (const { booking, person, trip, shop } of rows) {
    if (alreadySent.has(booking.id)) {
      summary.skipped += 1;
      continue;
    }
    // **A recap four hours after a night dive lands at 3 AM, in every zone.**
    // The demo shop's own board carries a 7:30–11:00 PM night dive, so this is
    // not an edge case a market avoids — it is any shop that dives after dark
    // (issue #697). Held rather than dropped, and safely so: a recap is due
    // from `endsAt + 4h` onwards with no upper bound, so the condition simply
    // stays true until this hourly pass next runs inside the shop's own hours.
    if (
      !maySendNow("trip_recap", now, shop.timezone, {
        startHour: shop.sendWindowStartHour,
        endHour: shop.sendWindowEndHour,
      })
    ) {
      summary.held += 1;
      continue;
    }

    const recapUrl = origin ? new URL(recapLinkPath(booking.id), `${origin}/`).toString() : null;
    const phone = smsRecipient(person.phone);
    const sites = siteNamesByTrip.get(trip.id) ?? [];
    // No request to negotiate Accept-Language from at a cron fire — but this
    // diver may have told us first-hand on a request of their own, and that
    // outranks the shop's default (docs ADR
    // 20260731-per-person-notification-locale). Null falls back to the shop
    // locale, exactly as before the column existed.
    const locale = recipientLocale(person.locale, shop.defaultLocale);
    const t = diverTranslator(locale);
    const smsBody = recapUrl
      ? t("notifications.sms.recap", { shopName: shop.name, tripTitle: trip.title, recapUrl })
      : "";

    if (recapUrl && person.email && !person.courtesyEmailOptOutAt) {
      const unsubscribeToken = await issuePersonCourtesyEmailUnsubscribeToken(db, {
        shopId: shop.id,
        personId: person.id,
      });
      emailWork.push({
        bookingId: booking.id,
        shopId: shop.id,
        shopName: shop.name,
        phone,
        smsBody,
        notification: {
          kind: "trip_recap",
          bookingId: booking.id,
          shopId: shop.id,
          to: person.email,
          locale,
          diverName: person.fullName,
          shopName: shop.name,
          tripTitle: trip.title,
          startsAt: trip.startsAt,
          timezone: shop.timezone,
          sites,
          recapUrl,
          unsubscribeUrl: new URL(`/unsubscribe/${unsubscribeToken}`, `${origin}/`).toString(),
        },
      });
    } else if (recapUrl && phone) {
      smsWork.push({
        bookingId: booking.id,
        shopId: shop.id,
        shopName: shop.name,
        phone,
        smsBody,
      });
    } else if (recapUrl && person.email && person.courtesyEmailOptOutAt) {
      // Opted out of courtesy email and no phone to fall back to — not a
      // delivery problem, so no `not_configured` row; just don't send.
      summary.optedOut += 1;
    } else {
      // No app origin (no link to send) or no reachable channel — record the gap.
      await recordNotificationDelivery(db, {
        shopId: shop.id,
        bookingId: booking.id,
        kind: "trip_recap",
        delivery: { status: "not_configured" },
      });
      summary.failed += 1;
    }
  }

  const emailDeliveries = await sendNotificationBatch(
    db,
    emailWork.map((work) => work.notification),
    emailProvider,
  );
  for (let index = 0; index < emailWork.length; index += 1) {
    const work = emailWork[index];
    const delivery = emailDeliveries[index] ?? { status: "failed" as const, retryable: true };
    // Not recorded: email is the tracked channel here, and a courtesy text
    // that failed must not overwrite a delivered email.
    if (delivery.status === "sent" && work.phone) {
      await sendCourtesyMessage(
        { to: work.phone, body: work.smsBody, shopName: work.shopName },
        { sms: smsProvider, whatsapp: whatsAppProviders.get(work.shopId) ?? null },
      );
    }
    await recordNotificationDelivery(db, {
      shopId: work.shopId,
      bookingId: work.bookingId,
      kind: "trip_recap",
      delivery,
    });
    if (delivery.status === "sent") summary.sent += 1;
    else summary.failed += 1;
  }

  for (const work of smsWork) {
    // Phone-only diver: the courtesy text is the tracked channel, whichever of
    // WhatsApp or SMS carried it.
    const { delivery } = await sendCourtesyMessage(
      { to: work.phone, body: work.smsBody, shopName: work.shopName },
      { sms: smsProvider, whatsapp: whatsAppProviders.get(work.shopId) ?? null },
    );
    await recordNotificationDelivery(db, {
      shopId: work.shopId,
      bookingId: work.bookingId,
      kind: "trip_recap",
      delivery,
    });
    if (delivery.status === "sent") summary.sent += 1;
    else summary.failed += 1;
  }

  return summary;
}
