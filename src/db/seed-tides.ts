import { and, eq, inArray } from "drizzle-orm";
import type { TidePreference } from "@/lib/tides";
import type { DbExecutor } from "./client";
import { diveSites, shops } from "./schema";

/**
 * **Which NOAA station the demo's Key Largo sites read their tide from**
 * (ADR 20260907-noaa-tide-predictions).
 *
 * Updates only, like `seed-trip-legs.ts`: the two sites are `seed-dive-sites.ts`'s
 * rows, and this module sets two columns on them rather than wedging a station
 * id into that file's already-long inserts. Nothing is inserted, so the shared
 * `nextCreatedAt()` counter never moves.
 *
 * **8723583 is Carysfort Reef**, the nearest ocean-side prediction station to
 * both sites — checked against NOAA's station list on 2026-09-07, which has no
 * station on Molasses Reef itself and puts Vaca Key (the nearest harmonic
 * station) eighty kilometres down the Keys at Marathon. Molasses is a sheltered
 * shallow reef and takes `any`; the Spiegel Grove sits in open water where the
 * current runs, and `slack` is how every Key Largo operator times it. Together
 * the two show both shapes of the sentence.
 *
 * The public toggle rides `includeHistoryData`, so it is on for **any demo
 * seeded with history** — the canonical `blue-mantis` fixture and the visitor's
 * "Try the live demo" mint alike, since `createDemoShop` defaults history on.
 * Both halves of why that is the right default still hold: the diver's trip
 * page is where the sentence has to earn a visual baseline, and a shop minted
 * by `privateShop` (ADR 20260815-per-test-private-shops) keeps the product
 * default so a spec can watch the setting turn it on — because that route mints
 * with `history: false` (`/api/test/seed-private-shop`), not because the slug is
 * checked here. Nothing in this module reads the slug.
 */
const SITE_TIDES: Record<string, { stationId: string; preference: TidePreference }> = {
  "Molasses Reef": { stationId: "8723583", preference: "any" },
  "Spiegel Grove": { stationId: "8723583", preference: "slack" },
};

export async function seedTides(
  db: DbExecutor,
  shopId: string,
  includeHistoryData: boolean,
): Promise<void> {
  const names = Object.keys(SITE_TIDES);
  const rows = await db
    .select({ id: diveSites.id, name: diveSites.name })
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shopId), inArray(diveSites.name, names)));
  // Loud, not silent: the names belong to another scenario module, and a
  // rename there is the one way this can quietly stop doing anything.
  const found = new Set(rows.map((row) => row.name));
  const missing = names.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`seed: tide stations name dive sites that do not exist: ${missing.join(", ")}`);
  }
  // Sequential: this can be handed a transaction (`scripts/check-db-concurrency.mjs`).
  for (const row of rows) {
    const tide = SITE_TIDES[row.name];
    if (!tide) continue;
    await db
      .update(diveSites)
      .set({ tideStationId: tide.stationId, tidePreference: tide.preference })
      .where(eq(diveSites.id, row.id));
  }
  if (includeHistoryData) {
    await db.update(shops).set({ tideWindowPublic: true }).where(eq(shops.id, shopId));
  }
}
