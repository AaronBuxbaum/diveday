import { and, eq, inArray, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
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
 * **Runs on every reset, and writes the words only once.** It sits inside
 * `seedDemoSchedule`, which `resetDemoShop` calls again for each e2e test — but
 * a lens is shop *configuration*, like a hull, and the reset deliberately does
 * not clear it. So the words are inserted only where they are missing (the
 * per-shop unique slug index would otherwise refuse the second reset and take
 * the whole seed transaction with it), while the trip assignments are re-applied
 * every time, because the reset has just rebuilt the departures they hang on.
 *
 * The timestamps are spaced a second apart rather than left to `now()`: six rows
 * in one statement all share the transaction's clock, and `listTripLenses`
 * orders by `created_at`, so an unspaced insert would render the rail in an
 * arbitrary order instead of the one the shop wrote.
 *
 * Runs after `seedMoreTrips` so every title it names exists; a title the seed no
 * longer carries simply matches nothing, which is the right failure for a demo
 * fixture — a throw here would break every seeded shop over a renamed trip.
 */
export async function seedLenses(db: DbExecutor, shopId: string): Promise<void> {
  const existing = await db
    .select({ id: tripLenses.id, name: tripLenses.name })
    .from(tripLenses)
    .where(and(eq(tripLenses.shopId, shopId), isNull(tripLenses.deletedAt)));
  const idByName = new Map(existing.map((row) => [row.name, row.id]));

  const missing = DEMO_LENSES.filter((name) => !idByName.has(name));
  if (missing.length > 0) {
    const base = nowDate().getTime();
    const inserted = await db
      .insert(tripLenses)
      .values(
        missing.map((name, index) => ({
          shopId,
          name,
          slug: lensSlugFrom(name),
          createdAt: new Date(base + index * 1000),
        })),
      )
      .returning({ id: tripLenses.id, name: tripLenses.name });
    for (const row of inserted) idByName.set(row.name, row.id);
  }

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
