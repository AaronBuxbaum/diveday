import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { trips } from "./schema";
import { demoReefDiverIndexes } from "./seed-bookings";
import { customerDefs } from "./seed-cast";

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

/**
 * **No child on a night boat** (UX review 2026-10-13, item 40). A demo seeded
 * in the evening sails today's reef boat at 11:30 PM, and its thirteen-year-old
 * with a birthday callout was aboard until 3:00 AM.
 */
describe("demoReefDiverIndexes", () => {
  const LENA = customerDefs.findIndex((diver) => diver.fullName === "Lena Fischer");

  it("seats the thirteen-year-old on a day boat", () => {
    expect(demoReefDiverIndexes(new Date("2026-07-21T18:30:00Z"))).toContain(LENA); // 2:30 PM EDT
  });

  it("keeps her off a night boat, and keeps the boat's count", () => {
    const night = demoReefDiverIndexes(new Date("2026-10-13T03:30:00Z")); // 11:30 PM EDT
    expect(night).not.toContain(LENA);
    expect(night).toHaveLength(9);
    expect(new Set(night).size).toBe(9);
  });
});
