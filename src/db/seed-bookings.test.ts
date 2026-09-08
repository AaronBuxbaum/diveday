import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { trips } from "./schema";

/**
 * The seeded crew shout-out is prose the demo shop "wrote" about its own day,
 * so it stays here as seed data rather than moving to a message bundle — the
 * convention `seed-lenses.ts` states, and the one that keeps a shop's own words
 * out of DiveDay's translations.
 *
 * What it must not do is name a shop. `seedBookings` runs for the canonical
 * demo *and* for every shop minted through `/api/test/seed-private-shop`
 * (ADR 20260815-per-test-private-shops), so a shop name written into this prose
 * lands on a recap belonging to a shop of an entirely different name — which is
 * what a diver reads, verbatim, on `/recap/[token]` (issue #1513).
 */
describe("the seeded crew shout-out", () => {
  it("names no shop, because the same seed mints shops of other names", async () => {
    const { db, shop } = await seededShopContext({ history: true });

    const rows = await db
      .select({ shoutout: trips.recapShoutout })
      .from(trips)
      .where(eq(trips.shopId, shop.id));
    const shoutouts = rows
      .map((row) => row.shoutout)
      .filter((words): words is string => Boolean(words));

    // Guard against the assertion below passing because nothing was seeded.
    expect(shoutouts.length).toBeGreaterThan(0);

    // "Blue Mantis Divers", and the brand on its own — a diver reading a minted
    // shop's recap should meet neither.
    const brand = shop.name.split(" ").slice(0, 2).join(" ");
    for (const words of shoutouts) {
      expect(words).not.toContain(shop.name);
      expect(words).not.toContain(brand);
    }
  });
});
