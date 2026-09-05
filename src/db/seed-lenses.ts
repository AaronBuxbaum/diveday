import { and, eq, inArray } from "drizzle-orm";
import { lensSlugFrom } from "@/lib/trip-lenses";
import type { DbExecutor } from "./client";
import { tripLenses, trips } from "./schema";

/**
 * **The demo shop's own words for its kinds of day** — ADR
 * 20260904-reef-all-the-way-down, decision 2 (issue #1162).
 *
 * Six words in the order the canvas draws its rail, which is also the order
 * `listTripLenses` reads them: a lens has no `position` column, and insertion
 * order *is* the vocabulary's order.
 *
 * They are Blue Mantis's words rather than DiveDay's, so they are seed data and
 * never a message bundle — the same contract as a boat's description or a
 * site's fit tone, and the reason a Spanish-reading diver sees this rail in the
 * shop's language.
 */
const DEMO_LENSES = [
  "Easygoing reef",
  "Wrecks",
  "After dark",
  "Small life & cameras",
  "First time back in a while",
  "Learning",
] as const;

/**
 * Which seeded departures wear which word, by title.
 *
 * **`Morning Two-Tank — Molasses Reef` is deliberately absent.** It is the
 * `at(1, 7:00)` departure from `seed-more-trips.ts`, so it lands on page one of
 * the storefront, and a row with no lens must render its meta line with no
 * leading separator and no placeholder. That silence is the thing the visual
 * capture needs in front of it; without an unlensed row on the first screen,
 * nothing looks at it.
 */
const LENS_BY_TRIP_TITLE: Record<string, (typeof DEMO_LENSES)[number]> = {
  "Two-Tank Reef — Molasses & French": "Easygoing reef",
  "Two-Tank Reef — French Reef": "Easygoing reef",
  "Two-Tank Reef — Benwood & Molasses": "Easygoing reef",
  "Two-Tank Reef — Pickles Reef": "Easygoing reef",
  "Two-Tank Reef — Pickles & French": "Easygoing reef",
  "Two-Tank Reef — French Reef & Molasses": "Easygoing reef",
  "Family Two-Tank — Christ of the Abyss": "Easygoing reef",
  "Midweek Two-Tank — Molasses Reef": "Easygoing reef",
  "Two-Site Combo — Statue & Molasses Reef": "Easygoing reef",
  "Wreck Trip — Spiegel Grove": "Wrecks",
  "Wreck Trip — USCGC Duane": "Wrecks",
  "Two-Tank Reef — Benwood Wreck": "Wrecks",
  "Advanced Wreck — USCGC Duane": "Wrecks",
  "Wreck Diver — PADI four dives": "Wrecks",
  "Night Dive — French Reef": "After dark",
  "Sunset Two-Tank — French Reef": "After dark",
  "Sunset Two-Tank — Christ of the Abyss (weather hold)": "After dark",
  "Scuba Refresher — half day": "First time back in a while",
  "Discover Scuba Diving — afternoon": "Learning",
  "Try Scuba — SSI first dive": "Learning",
  "Open Water Diver — three-day course": "Learning",
  "Three-Day SSI Certification — Open Water": "Learning",
  "Rescue Diver — three-day course": "Learning",
  "Advanced Adventurer — two-day course": "Learning",
  "Diver Stress & Rescue — SSI two-day": "Learning",
  "Nitrox 40 — SSI one day": "Learning",
  "Peak Performance Buoyancy — weekend": "Small life & cameras",
};

/**
 * Writes the demo vocabulary and hangs the seeded departures on it.
 *
 * Runs after `seedMoreTrips` so every title it names exists; a title the seed
 * no longer carries simply matches nothing, which is the right failure for a
 * demo fixture (a throw here would break every seeded shop over a renamed
 * trip).
 */
export async function seedLenses(db: DbExecutor, shopId: string): Promise<void> {
  const inserted = await db
    .insert(tripLenses)
    .values(
      DEMO_LENSES.map((name) => ({
        shopId,
        name,
        slug: lensSlugFrom(name),
      })),
    )
    .returning({ id: tripLenses.id, name: tripLenses.name });
  const idByName = new Map(inserted.map((row) => [row.name, row.id]));

  const titlesByLens = new Map<string, string[]>();
  for (const [title, lensName] of Object.entries(LENS_BY_TRIP_TITLE)) {
    const lensId = idByName.get(lensName);
    if (!lensId) continue;
    titlesByLens.set(lensId, [...(titlesByLens.get(lensId) ?? []), title]);
  }

  for (const [lensId, titles] of titlesByLens) {
    await db
      .update(trips)
      // diveday:allow-deleted-trips: this is the seed hanging its own fixture
      // rows on a word, not a surface reading the board.
      .set({ lensId })
      .where(and(eq(trips.shopId, shopId), inArray(trips.title, titles)));
  }
}
