import { describe, expect, it } from "vitest";
import { EMBED_SET_MAX } from "@/lib/embed-sets";
import { seededShopContext } from "@/test/db";
import { listEmbedSets, listEmbedSetTrips } from "./embed-sets";

describe("the demo shop's named embed list", () => {
  it("names departures that exist on the demo shop, inside the cap", async () => {
    const { db, shop } = await seededShopContext();
    const sets = await listEmbedSets(db, shop.id);
    const beginners = sets.find((set) => set.name === "Beginner boats");
    expect(beginners).toBeDefined();
    expect(beginners?.kind).toBe("trip");
    expect(beginners?.memberIds.length).toBeGreaterThan(0);
    expect(beginners?.memberIds.length).toBeLessThanOrEqual(EMBED_SET_MAX);

    // Every member resolves, so the settings card and the widget photograph a
    // populated list rather than a name over nothing.
    const resolved = await listEmbedSetTrips(db, shop.id, beginners?.memberIds ?? []);
    expect(resolved).toHaveLength(beginners?.memberIds.length ?? 0);
  });

  it("still resolves after a schedule reset, rather than piling up stale lists", async () => {
    // A list holds trip ids in **jsonb**, so no foreign key stops a row
    // outliving the departures it names — it resolves to an empty widget
    // instead, silently, for the rest of an e2e run. This caught the e2e
    // fleet: `/api/test/reset` replaces every trip, and the first version of
    // `resetDemoSchedule` left the old list standing beside the new one.
    const { db, shop } = await seededShopContext();
    const { resetDemoSchedule } = await import("./seed");
    await resetDemoSchedule(db, shop.id);

    const sets = await listEmbedSets(db, shop.id);
    expect(sets.filter((set) => set.name === "Beginner boats")).toHaveLength(1);
    const beginners = sets.find((set) => set.name === "Beginner boats");
    const resolved = await listEmbedSetTrips(db, shop.id, beginners?.memberIds ?? []);
    expect(resolved).toHaveLength(beginners?.memberIds.length ?? 0);
    expect(resolved.length).toBeGreaterThan(0);
  });
});
