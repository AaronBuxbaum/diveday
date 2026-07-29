import { and, desc, eq, gt, inArray, lte, ne, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { type Notification, type NotificationProvider, publicAppUrl } from "@/lib/notifications";
import {
  notifySms,
  type SmsProvider,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications/sms";
import type { CheckoutProvider } from "@/lib/payments/checkout";
import { recapLinkPath } from "@/lib/recap-links";
import type { AppDb } from "./client";
import {
  notificationProviderForDb,
  recordNotificationDelivery,
  sendNotificationBatch,
} from "./notifications";
import { bookings, notificationDeliveries, people, recapPhotos, shops, trips } from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { getLatestTipForBooking, refreshTipFromStripe } from "./tips";
import { getTripWithBooked, listTripDives } from "./trips";

/** A diver's own recap photo, as the recap page renders it. */
export type RecapPhotoView = { id: string; imageUrl: string; caption: string | null };

/**
 * The post-trip recap: a single shareable page per diver per trip, generated
 * from the same source-of-truth trip and dive-site data the staff and booking
 * surfaces use. This is brainstorm C's "word-of-mouth window, weaponized" — the
 * highest-leverage marketing moment a shop has is the hours after a great dive,
 * and today it's unused. The page (`/recap/[token]`) is public via a signed
 * booking token; `sendDueRecaps` delivers the link once the trip departs.
 */

/** A site the trip dived, as the recap page names it. */
export type RecapSite = {
  name: string;
  locationName: string | null;
  marineLife: string | null;
  forecastLatitude: number | null;
  forecastLongitude: number | null;
};

export type RecapPageData = {
  shop: {
    name: string;
    slug: string;
    timezone: string;
    defaultLocale: string;
    contactEmail: string | null;
    contactPhone: string | null;
    /** Where a "leave us a review" link sends the diver, or null when the shop hasn't set one. */
    reviewUrl: string | null;
  };
  trip: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    plannedDives: number;
    waterTemperatureC: number | null;
    visibilityMeters: number | null;
    surfaceConditions: string | null;
  };
  diverName: string;
  sites: RecapSite[];
  /** The booking this recap belongs to — the scope an uploaded photo attaches to. */
  bookingId: string;
  /** A short crew-authored note for this trip, or null when the crew wrote none. */
  shoutout: string | null;
  /** The diver's own uploaded photos, newest first. */
  photos: RecapPhotoView[];
  /** True when the shop's own Stripe account can take a tip charge right now. */
  canTip: boolean;
  /** The most recent tip attempt for this booking, if any — drives the tip panel's state. */
  tip: {
    status: "pending" | "paid" | "expired";
    amountCents: number;
    checkoutUrl: string | null;
  } | null;
};

/** How many photos one booking may attach — a memory strip, not a media host. */
export const MAX_RECAP_PHOTOS_PER_BOOKING = 12;

/**
 * Server-side caption bound. The upload form caps at this length client-side, but
 * the endpoint is public (token-auth), so the real cap lives here: an untrusted
 * caller's caption is truncated, never stored unbounded.
 */
export const MAX_RECAP_CAPTION_LENGTH = 140;

/**
 * Everything the recap page renders for one booking, or null when the booking
 * is missing or cancelled — a cancelled diver never dived, so there's no recap.
 * Sites are de-duplicated by name in dive order, so a two-tank day on one site
 * reads as one site, not two.
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
      status: bookings.status,
      diverName: people.fullName,
      diverEmail: people.email,
      shopName: shops.name,
      slug: shops.slug,
      timezone: shops.timezone,
      defaultLocale: shops.defaultLocale,
      contactEmail: shops.contactEmail,
      contactPhone: shops.contactPhone,
      reviewUrl: shops.reviewUrl,
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

  const dives = await listTripDives(db, row.shopId, row.tripId);
  const sites: RecapSite[] = [];
  const seen = new Set<string>();
  for (const { diveSite } of dives) {
    if (!diveSite || seen.has(diveSite.name)) continue;
    seen.add(diveSite.name);
    sites.push({
      name: diveSite.name,
      locationName: diveSite.locationName,
      marineLife: diveSite.marineLife,
      forecastLatitude: diveSite.forecastLatitude,
      forecastLongitude: diveSite.forecastLongitude,
    });
  }

  const [photos, stripeAccount, latestTip] = await Promise.all([
    listRecapPhotosForBooking(db, bookingId),
    getShopStripeAccount(db, row.shopId),
    getLatestTipForBooking(db, row.shopId, bookingId),
  ]);
  // A still-pending tip's local status is a lead, not proof — a delayed or
  // missed webhook must never leave the page offering a dead Checkout link,
  // or (via a bare `?tip=paid` return-URL) reading as confirmed when Stripe
  // itself hasn't said so.
  const tip =
    latestTip?.status === "pending"
      ? await refreshTipFromStripe(db, row.shopId, latestTip.id, checkoutProvider)
      : latestTip;

  return {
    shop: {
      name: row.shopName,
      slug: row.slug,
      timezone: row.timezone,
      defaultLocale: row.defaultLocale,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      reviewUrl: row.reviewUrl,
    },
    trip: {
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      plannedDives: trip.plannedDives,
      waterTemperatureC: trip.waterTemperatureC,
      visibilityMeters: trip.visibilityMeters,
      surfaceConditions: trip.surfaceConditions,
    },
    diverName: row.diverName,
    sites,
    bookingId,
    shoutout: trip.recapShoutout,
    photos,
    // A phone-only diver (a supported case — their recap can go out by SMS
    // instead) has nothing `startTipCheckout` can hand to Stripe as a
    // customer email; offering the form anyway would fail on every
    // submission (Codex finding).
    canTip: Boolean(row.diverEmail) && canAcceptPayments(stripeAccount),
    tip: tip
      ? {
          status: tip.status,
          amountCents: tip.amountCents,
          checkoutUrl: tip.checkoutUrl,
        }
      : null,
  };
}

/** A diver's own recap photos for one booking, newest first. */
export async function listRecapPhotosForBooking(
  db: AppDb,
  bookingId: string,
): Promise<RecapPhotoView[]> {
  const rows = await db
    .select({ id: recapPhotos.id, imageUrl: recapPhotos.imageUrl, caption: recapPhotos.caption })
    .from(recapPhotos)
    .where(eq(recapPhotos.bookingId, bookingId))
    .orderBy(desc(recapPhotos.createdAt));
  return rows;
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

/** Set (or clear, with an empty string) a trip's crew-authored recap shout-out. */
export async function setTripRecapShoutout(
  db: AppDb,
  shopId: string,
  tripId: string,
  shoutout: string,
): Promise<boolean> {
  const [trip] = await db
    .update(trips)
    .set({ recapShoutout: shoutout.trim() || null })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .returning({ id: trips.id });
  return Boolean(trip);
}

const HOUR_MS = 60 * 60 * 1000;
/**
 * How far back a run looks for departed trips. A daily cron catches a trip on
 * the next run after it ends; 48h leaves a full missed-run of slack, and the
 * once-per-booking `trip_recap` delivery row means an overlapping window never
 * double-sends (docs ADR 20260721-scheduled-reminder-cadence).
 */
export const RECAP_LOOKBACK_HOURS = 48;

export type RecapRunSummary = {
  /** Active bookings on trips that departed inside the lookback window. */
  scanned: number;
  /** Recaps whose tracked channel reported a real send. */
  sent: number;
  /** Bookings whose recap was already delivered. */
  skipped: number;
  /** Recaps whose tracked channel failed or was not configured. */
  failed: number;
};

export type SendDueRecapsOptions = {
  now?: Date;
  emailProvider?: NotificationProvider;
  smsProvider?: SmsProvider;
  /** Origin for the recap link; defaults to the configured public app URL. */
  appOrigin?: string | null;
};

/**
 * Send the post-trip recap for every booking on a trip that departed within the
 * lookback window and hasn't been sent one yet. Idempotent by the same
 * one-row-per-(booking, kind) delivery dedup as the pre-trip reminders. The
 * recap link is the whole point, so a run with no resolvable app origin records
 * `not_configured` (surfaced on the staff dashboard) rather than sending a
 * dead-end email. Email is the tracked channel; a textable phone gets a
 * courtesy SMS on top.
 */
export async function sendDueRecaps(
  db: AppDb,
  options: SendDueRecapsOptions = {},
): Promise<RecapRunSummary> {
  const now = options.now ?? nowDate();
  const emailProvider = notificationProviderForDb(db, options.emailProvider);
  const smsProvider = options.smsProvider ?? smsProviderFromEnvironment();
  const origin = options.appOrigin === undefined ? publicAppUrl() : options.appOrigin;
  const since = new Date(now.getTime() - RECAP_LOOKBACK_HOURS * HOUR_MS);

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
        lte(trips.endsAt, now),
        gt(trips.endsAt, since),
      ),
    );

  const summary: RecapRunSummary = { scanned: rows.length, sent: 0, skipped: 0, failed: 0 };
  if (rows.length === 0) return summary;

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
  // once per distinct trip in the run rather than per booking.
  const siteNamesByTrip = new Map<string, string[]>();
  for (const tripId of new Set(rows.map((r) => r.trip.id))) {
    const shopId = rows.find((r) => r.trip.id === tripId)?.shop.id;
    if (!shopId) continue;
    const dives = await listTripDives(db, shopId, tripId);
    const names: string[] = [];
    for (const { diveSite } of dives) {
      if (diveSite && !names.includes(diveSite.name)) names.push(diveSite.name);
    }
    siteNamesByTrip.set(tripId, names);
  }

  const emailWork: Array<{
    bookingId: string;
    shopId: string;
    phone: string | null;
    smsBody: string;
    notification: Notification;
  }> = [];
  const smsWork: Array<{
    bookingId: string;
    shopId: string;
    phone: string;
    smsBody: string;
  }> = [];

  for (const { booking, person, trip, shop } of rows) {
    if (alreadySent.has(booking.id)) {
      summary.skipped += 1;
      continue;
    }

    const recapUrl = origin ? new URL(recapLinkPath(booking.id), `${origin}/`).toString() : null;
    const phone = smsRecipient(person.phone);
    const sites = siteNamesByTrip.get(trip.id) ?? [];

    if (recapUrl && person.email) {
      emailWork.push({
        bookingId: booking.id,
        shopId: shop.id,
        phone,
        smsBody: `${shop.name}: thanks for diving ${trip.title}! Your recap: ${recapUrl}`,
        notification: {
          kind: "trip_recap",
          bookingId: booking.id,
          shopId: shop.id,
          to: person.email,
          diverName: person.fullName,
          shopName: shop.name,
          tripTitle: trip.title,
          startsAt: trip.startsAt,
          timezone: shop.timezone,
          sites,
          recapUrl,
        },
      });
    } else if (recapUrl && phone) {
      smsWork.push({
        bookingId: booking.id,
        shopId: shop.id,
        phone,
        smsBody: `${shop.name}: thanks for diving ${trip.title}! Your recap: ${recapUrl}`,
      });
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
    if (delivery.status === "sent" && work.phone) {
      await notifySms({ channel: "sms", to: work.phone, body: work.smsBody }, smsProvider);
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
    const delivery = await notifySms(
      { channel: "sms", to: work.phone, body: work.smsBody },
      smsProvider,
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
