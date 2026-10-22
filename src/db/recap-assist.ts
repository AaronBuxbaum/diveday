import { and, eq, isNull } from "drizzle-orm";
import { marineLifeCatalogCards } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import {
  RECAP_LINE_FEATURE,
  type RecapLog,
  recapLine,
  recapLineCall,
} from "@/lib/assists/recap-line";
import { temperatureInUnit, temperatureUnitFor } from "@/lib/temperature-units";
import { shopAssist } from "./assist-shop";
import type { AssistOptions } from "./assists";
import type { AppDb } from "./client";
import { incidentReports, shops, tripSightings, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **recap**: the recap's highlight line, drafted from what the crew logged on
 * the boat: the sites and the sightings by name, and the water they recorded.
 * Never the crew's free-text notes and never anything about a diver: the
 * line is about the reef. It may name only species the crew logged, and only
 * by the names DiveDay gives them (`recapLine` refuses any other species in
 * any of the app's languages).
 */

/** Every catalog species with its names in each language the app writes, for the refusal check. */
function catalogNames(): { slug: string; names: string[] }[] {
  const en = marineLifeCatalogCards(diverTranslator("en-US"));
  const es = new Map(
    marineLifeCatalogCards(diverTranslator("es-ES")).map((card) => [card.slug, card.name]),
  );
  return en.map((card) => ({
    slug: card.slug,
    names: [card.name, es.get(card.slug) ?? card.name],
  }));
}

/** What the crew logged on this departure, as the line's facts, or null with no sightings. */
export async function recapLogFor(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<RecapLog | null> {
  const [row] = await db
    .select({ trip: trips, shop: shops })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!row) return null;
  const sightings = await db
    .select({
      slug: tripSightings.speciesSlug,
      count: tripSightings.count,
      site: tripSightings.diveSiteName,
    })
    .from(tripSightings)
    .where(
      and(
        eq(tripSightings.tripId, tripId),
        eq(tripSightings.shopId, shopId),
        isNull(tripSightings.deletedAt),
      ),
    );
  if (sightings.length === 0) return null;
  const locale = row.shop.defaultLocale;
  const names = new Map<string, string>(
    marineLifeCatalogCards(diverTranslator(locale)).map((card) => [card.slug, card.name]),
  );
  // Grouped by the site they were logged at, so the line cannot move a
  // creature to another reef; a count is summed only within its own site.
  const bySite = new Map<string, Map<string, number>>();
  for (const sighting of sightings) {
    if (!names.has(sighting.slug)) continue;
    const counts = bySite.get(sighting.site) ?? new Map<string, number>();
    counts.set(sighting.slug, (counts.get(sighting.slug) ?? 0) + sighting.count);
    bySite.set(sighting.site, counts);
  }
  if (bySite.size === 0) return null;
  const conditions: Record<string, string> = {};
  if (typeof row.trip.waterTemperatureC === "number") {
    const unit = temperatureUnitFor(row.shop);
    conditions.waterTemp = `${temperatureInUnit(row.trip.waterTemperatureC, unit)}°${unit === "fahrenheit" ? "F" : "C"}`;
  }
  return {
    locale,
    sites: [...bySite].map(([name, counts]) => ({
      name,
      species: [...counts].map(([slug, count]) => ({ slug, name: names.get(slug) ?? slug, count })),
    })),
    conditions,
  };
}

/** The highlight line for this departure, or null when there is nothing to say or the assist is dark. */
export async function draftRecapLine(
  db: AppDb,
  shopId: string,
  tripId: string,
  options: AssistOptions = {},
): Promise<string | null> {
  const log = await recapLogFor(db, shopId, tripId);
  if (!log) return null;
  const value = await shopAssist(db, {
    ...options,
    shopId,
    feature: RECAP_LINE_FEATURE,
    call: recapLineCall(log),
  });
  return recapLine(value, log, catalogNames());
}

async function hasLiveIncidentReport(db: AppDb, shopId: string, tripId: string) {
  const [report] = await db
    .select({ id: incidentReports.id })
    .from(incidentReports)
    .where(
      and(
        eq(incidentReports.shopId, shopId),
        eq(incidentReports.tripId, tripId),
        isNull(incidentReports.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(report);
}

/**
 * The shop's "Recap highlights" switch, at send time: a departure whose crew
 * left the highlight blank gets Claude's line, written to the trip as if the
 * crew had saved it, so the page and the email read one text. Only a blank
 * one: a crew's own words are never replaced, and never on a departure with a
 * live incident report. Returns whether it wrote.
 */
export async function autoFillRecapLine(
  db: AppDb,
  trip: { id: string; shopId: string; recapShoutout: string | null },
  shop: { recapAssistAutoApprove: boolean },
  options: AssistOptions = {},
): Promise<boolean> {
  if (!shop.recapAssistAutoApprove || trip.recapShoutout?.trim()) return false;
  // A recap is never held up by its highlight: any failure here is no line.
  try {
    // A departure with an incident report gets no line nobody read: the recap
    // may reach the diver it is about, or their family. The crew can still
    // draft one on Today and send it themselves.
    if (await hasLiveIncidentReport(db, trip.shopId, trip.id)) return false;
    const line = await draftRecapLine(db, trip.shopId, trip.id, options);
    if (!line) return false;
    const [written] = await db
      .update(trips)
      .set({ recapShoutout: line })
      .where(and(eq(trips.id, trip.id), eq(trips.shopId, trip.shopId), isNull(trips.recapShoutout)))
      .returning({ id: trips.id });
    return Boolean(written);
  } catch {
    return false;
  }
}
