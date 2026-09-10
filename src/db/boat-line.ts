import { and, asc, desc, eq } from "drizzle-orm";
import { boatLineClosesAt } from "@/lib/boat-line";
import {
  DEFAULT_DOCK_DAY_RHYTHM,
  type DockDayRhythm,
  parseDockDayRhythm,
} from "@/lib/diver-planning";
import { STAGE_STALE_AFTER_MS, type TripStage } from "@/lib/trip-stages";
import type { DbExecutor } from "./client";
import { boats, diveSites, shops, tripDives, tripStageEvents, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **The one read behind a stranger's page** — ADR 20260908-one-hand, decision
 * 6, lever U.
 *
 * `liveShopStage` (src/db/trip-stages.ts) answers "which boat is out?" for the
 * storefront. This answers a narrower question about one departure — "where is
 * *this* boat in its day?" — for somebody a diver handed a link to, who is not
 * a customer, is not signed in, and holds no capability.
 *
 * Everything that could identify a person is absent **from the shape**, not
 * filtered at the surface: there is no roster here, no seat count, no
 * capacity, no crew name, no coordinate. A later edit that wanted to print one
 * would have to add a column to this type, which is the point — the same
 * reasoning `LiveShopStage` states for dropping `recordedByName`.
 *
 * Six refusals, each returning null rather than a partial page:
 *
 * - the shop has not turned the line on (`shops.public_boat_line`, off by
 *   default) — the switch is the shop's consent and nothing published survives
 *   its being off;
 * - the departure is not this shop's, or was deleted (`liveTrip()`);
 * - the departure was cancelled — a boat that is not sailing has no day, and a
 *   public page saying so is the shop's news to break, not DiveDay's;
 * - the departure is a private charter — its title is somebody's name often
 *   enough that publishing it to a stranger is a disclosure;
 * - the day has closed (`boatLineClosesAt`) — a link pasted into a group chat
 *   outlives its day, and a page that answers forever is a public record of a
 *   shop's operations nobody chose to publish.
 */
export type PublicBoatLine = {
  shop: {
    name: string;
    slug: string;
    timezone: string;
    defaultLocale: string;
    contactPhone: string | null;
    addressStreet: string | null;
    addressLocality: string | null;
    addressRegion: string | null;
    addressPostalCode: string | null;
    addressCountry: string | null;
    /** The shop's published rhythm, which is what draws the line's times. */
    rhythm: DockDayRhythm;
    diveMode: "boat" | "shore" | "pool";
  };
  trip: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date | null;
    /** The hull's own name where the shop keeps one on file. */
    boatName: string | null;
    meetingPointLabel: string | null;
    meetingPointAddress: string | null;
  };
  /** The plan's sites, dive 1 first; a dive with no site named is a null. */
  siteNames: (string | null)[];
  /** Each dive's own bottom time where the site states one, dive 1 first. */
  siteBottomTimes: (number | null)[];
  /** Each leg's own travel minutes where the departure states them, dive 1 first. */
  legTravelTimes: (number | null)[];
  /**
   * The crew's last word about this boat, or null when they have said nothing.
   * Deliberately without the crew member's name: this reader is not owed it,
   * and leaving it out of the type makes printing it a compile error.
   */
  word: { stage: TripStage; recordedAt: Date } | null;
};

/**
 * The public line for one departure, or null for every refusal above.
 *
 * `now` is passed rather than read so the caller owns the clock (the domain
 * rules' clock rule) and so a frozen-clock e2e run and a visual capture see
 * the same day.
 */
export async function publicBoatLine(
  db: DbExecutor,
  input: { shopSlug: string; tripId: string; now: Date },
): Promise<PublicBoatLine | null> {
  const [row] = await db
    .select({
      shopId: shops.id,
      shopName: shops.name,
      shopSlug: shops.slug,
      timezone: shops.timezone,
      defaultLocale: shops.defaultLocale,
      contactPhone: shops.contactPhone,
      addressStreet: shops.addressStreet,
      addressLocality: shops.addressLocality,
      addressRegion: shops.addressRegion,
      addressPostalCode: shops.addressPostalCode,
      addressCountry: shops.addressCountry,
      publicBoatLine: shops.publicBoatLine,
      dockCallMinutes: shops.dockCallMinutes,
      gearSetupMinutes: shops.gearSetupMinutes,
      briefingMinutes: shops.briefingMinutes,
      boatRideMinutes: shops.boatRideMinutes,
      bottomTimeMinutes: shops.bottomTimeMinutes,
      surfaceIntervalMinutes: shops.surfaceIntervalMinutes,
      tripId: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      status: trips.status,
      isPrivate: trips.isPrivate,
      diveMode: trips.diveMode,
      meetingPointLabel: trips.meetingPointLabel,
      meetingPointAddress: trips.meetingPointAddress,
      boatName: boats.name,
    })
    .from(trips)
    // Joined from the shop's slug rather than looked up separately, so a trip
    // id that names another shop's departure cannot be answered by pairing it
    // with this slug's shop row.
    .innerJoin(shops, eq(trips.shopId, shops.id))
    .leftJoin(boats, and(eq(trips.boatId, boats.id), eq(boats.shopId, shops.id)))
    .where(and(eq(shops.slug, input.shopSlug), eq(trips.id, input.tripId), liveTrip()))
    .limit(1);
  if (!row) return null;
  // The shop's consent, first: with the switch off nothing below this line is
  // published, and the caller renders a `notFound()` rather than an empty
  // state — a page that says "this shop does not share that" still confirms
  // the departure exists.
  if (!row.publicBoatLine) return null;
  if (row.status !== "scheduled") return null;
  if (row.isPrivate) return null;
  if (input.now > boatLineClosesAt(row.startsAt, row.endsAt, STAGE_STALE_AFTER_MS)) return null;

  const dives = await db
    .select({
      number: tripDives.diveNumber,
      travelMinutes: tripDives.travelMinutes,
      siteName: diveSites.name,
      siteBottomTimeMinutes: diveSites.expectedBottomTimeMinutes,
    })
    .from(tripDives)
    // Shop-scoped in its own right rather than only by way of the dive row:
    // these names are printed to an anonymous visitor, and the same join in
    // `latestTripStage` carries the same note for the same reason.
    .leftJoin(
      diveSites,
      and(eq(tripDives.diveSiteId, diveSites.id), eq(diveSites.shopId, row.shopId)),
    )
    .where(eq(tripDives.tripId, row.tripId))
    .orderBy(asc(tripDives.diveNumber));

  const [word] = await db
    .select({ stage: tripStageEvents.stage, recordedAt: tripStageEvents.recordedAt })
    .from(tripStageEvents)
    .where(and(eq(tripStageEvents.shopId, row.shopId), eq(tripStageEvents.tripId, row.tripId)))
    .orderBy(desc(tripStageEvents.recordedAt), desc(tripStageEvents.seq))
    .limit(1);

  return {
    shop: {
      name: row.shopName,
      slug: row.shopSlug,
      timezone: row.timezone,
      defaultLocale: row.defaultLocale,
      contactPhone: row.contactPhone,
      addressStreet: row.addressStreet,
      addressLocality: row.addressLocality,
      addressRegion: row.addressRegion,
      addressPostalCode: row.addressPostalCode,
      addressCountry: row.addressCountry,
      // `parseDockDayRhythm` refuses a rhythm outside its own bounds, which
      // the table's CHECK constraints already prevent — so the fallback is
      // unreachable rather than lenient, and it is DiveDay's own default day
      // rather than a partial line with holes in it.
      rhythm: parseDockDayRhythm(row) ?? DEFAULT_DOCK_DAY_RHYTHM,
      diveMode: row.diveMode,
    },
    trip: {
      id: row.tripId,
      title: row.title,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      boatName: row.boatName ?? null,
      meetingPointLabel: row.meetingPointLabel,
      meetingPointAddress: row.meetingPointAddress,
    },
    siteNames: dives.map((dive) => dive.siteName ?? null),
    siteBottomTimes: dives.map((dive) => dive.siteBottomTimeMinutes ?? null),
    legTravelTimes: dives.map((dive) => dive.travelMinutes ?? null),
    // Whatever its age. How old a word may be before the page names the time
    // it was said is `boatWordIsStale`'s call, and whether it still speaks at
    // all is `liveStageOf`'s — neither belongs in a query.
    word: word ? { stage: word.stage, recordedAt: word.recordedAt } : null,
  };
}
