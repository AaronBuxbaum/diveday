import { describe, expect, it } from "vitest";
import { listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";
import { readManifestPage } from "./manifest-reads";

const ctx = fileScopedShopContext();

describe("readManifestPage (in-memory PGlite)", () => {
  it("reads one departure's manifests and the departure's own rows, in one call", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");

    const reads = await readManifestPage(db, shop.id, reef.id, staff.person.id);

    // One manifest per checkpoint: the dock, then one after each planned dive.
    expect(reads.completeManifests?.map((entry) => entry.checkpoint)).toEqual([
      "departure",
      ...Array.from({ length: reef.plannedDives }, (_, index) => `after_dive_${index + 1}`),
    ]);
    expect(reads.completeManifests?.[0]?.divers.length).toBeGreaterThan(0);
    expect(reads.plannedDives.length).toBe(reef.plannedDives);
    // Never worked this departure: there is nothing for a catch-up to be "since".
    expect(reads.catchUp.mark).toBeNull();
    // The field guides are keyed by the live sites the first wave returned.
    for (const siteId of reads.fieldGuides.keys()) {
      expect(reads.liveDiveSites.map((site) => site.id)).toContain(siteId);
    }
  });

  it("reads nothing for a departure that is not this shop's", async () => {
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    const reads = await readManifestPage(
      db,
      shop.id,
      "00000000-0000-4000-8000-000000000000",
      staff?.person.id ?? "",
    );
    expect(reads.completeManifests?.[0]).toBeUndefined();
  });
});
