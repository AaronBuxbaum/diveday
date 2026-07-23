import { and, eq, gt, inArray, lte, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type NotificationDelivery,
  type NotificationProvider,
  notificationProviderFromEnvironment,
  notify,
  publicAppUrl,
} from "@/lib/notifications";
import {
  notifySms,
  type SmsProvider,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications/sms";
import { recapLinkPath } from "@/lib/recap-links";
import type { AppDb } from "./client";
import { recordNotificationDelivery } from "./notifications";
import { bookings, notificationDeliveries, people, shops, trips } from "./schema";
import { getTripWithBooked, listTripDives } from "./trips";

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
};

export type RecapPageData = {
  shop: {
    name: string;
    slug: string;
    timezone: string;
    contactEmail: string | null;
    contactPhone: string | null;
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
};

/**
 * Everything the recap page renders for one booking, or null when the booking
 * is missing or cancelled — a cancelled diver never dived, so there's no recap.
 * Sites are de-duplicated by name in dive order, so a two-tank day on one site
 * reads as one site, not two.
 */
export async function getRecapPageData(
  db: AppDb,
  bookingId: string,
): Promise<RecapPageData | null> {
  const [row] = await db
    .select({
      shopId: bookings.shopId,
      tripId: bookings.tripId,
      status: bookings.status,
      diverName: people.fullName,
      shopName: shops.name,
      slug: shops.slug,
      timezone: shops.timezone,
      contactEmail: shops.contactEmail,
      contactPhone: shops.contactPhone,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row || row.status === "cancelled") return null;

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
    });
  }

  return {
    shop: {
      name: row.shopName,
      slug: row.slug,
      timezone: row.timezone,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
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
  };
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
  const emailProvider = options.emailProvider ?? notificationProviderFromEnvironment();
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

  for (const { booking, person, trip, shop } of rows) {
    if (alreadySent.has(booking.id)) {
      summary.skipped += 1;
      continue;
    }

    const recapUrl = origin ? new URL(recapLinkPath(booking.id), `${origin}/`).toString() : null;
    const phone = smsRecipient(person.phone);
    const sites = siteNamesByTrip.get(trip.id) ?? [];

    let delivery: NotificationDelivery;
    if (recapUrl && person.email) {
      delivery = await notify(
        {
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
        emailProvider,
      );
      if (delivery.status === "sent" && phone) {
        await notifySms(
          {
            channel: "sms",
            to: phone,
            body: `${shop.name}: thanks for diving ${trip.title}! Your recap: ${recapUrl}`,
          },
          smsProvider,
        );
      }
    } else if (recapUrl && phone) {
      delivery = await notifySms(
        {
          channel: "sms",
          to: phone,
          body: `${shop.name}: thanks for diving ${trip.title}! Your recap: ${recapUrl}`,
        },
        smsProvider,
      );
    } else {
      // No app origin (no link to send) or no reachable channel — record the gap.
      delivery = { status: "not_configured" };
    }

    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: booking.id,
      kind: "trip_recap",
      delivery,
    });
    if (delivery.status === "sent") summary.sent += 1;
    else summary.failed += 1;
  }

  return summary;
}
