import { expect, it, vi } from "vitest";
import { listStaff, upcomingTripsWithCounts } from "@/db/trips";
import * as clock from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { readManifestPage } from "./manifest-reads";

const latch = vi.hoisted(() => ({
  reached: undefined as (() => void) | undefined,
  wait: undefined as Promise<void> | undefined,
  calls: 0,
}));
vi.mock("@/db/buddy-teams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/buddy-teams")>();
  return {
    ...actual,
    listTripBuddyTeams: async (...args: Parameters<typeof actual.listTripBuddyTeams>) => {
      const result = await actual.listTripBuddyTeams(...args);
      // The roster itself reads buddy teams; hold the subsequent page read.
      if (++latch.calls === 2) {
        latch.reached?.();
        await latch.wait;
      }
      return result;
    },
  };
});

it("records the roster read time before later manifest reads finish", async () => {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((row) => row.title.startsWith("Two-Tank Reef — Molasses"));
  const owner = (await listStaff(db, shop.id)).find((row) => row.roles.includes("owner"))?.person;
  if (!trip || !owner) throw new Error("seeded trip or owner missing");
  let reached!: () => void;
  let release!: () => void;
  const buddyRead = new Promise<void>((resolve) => {
    reached = resolve;
  });
  latch.reached = reached;
  latch.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const now = vi.spyOn(clock, "nowMs").mockReturnValue(1_794_581_040_000);
  try {
    const reading = readManifestPage(db, shop, trip.id, owner.id);
    await buddyRead;
    now.mockReturnValue(1_794_581_100_000);
    release();
    const result = await reading;
    expect(result.readCompletedAt).toBe(1_794_581_040_000);
  } finally {
    release();
    latch.wait = undefined;
    latch.reached = undefined;
    now.mockRestore();
  }
});
