import { expect, it, vi } from "vitest";
import { getShopOfflineErasureEpoch } from "@/db/shops";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { anonymizeDiver } from "@/features/anonymize/store";
import {
  signRosterConfirmation,
  verifyRosterConfirmation,
} from "@/features/offline-manifest-snapshots";
import { seededShopContext } from "@/test/db";
import { readManifestPage } from "./manifest-reads";

const latch = vi.hoisted(() => ({
  reached: undefined as (() => void) | undefined,
  wait: undefined as Promise<void> | undefined,
}));
vi.mock("@/db/buddy-teams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/buddy-teams")>();
  return {
    ...actual,
    listTripBuddyTeams: async (...args: Parameters<typeof actual.listTripBuddyTeams>) => {
      const result = await actual.listTripBuddyTeams(...args);
      latch.reached?.();
      await latch.wait;
      return result;
    },
  };
});

it("refuses to confirm a manifest assembled across an erasure", async () => {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((row) => row.title.startsWith("Two-Tank Reef — Molasses"));
  const owner = (await listStaff(db, shop.id)).find((row) => row.roles.includes("owner"))?.person;
  if (!trip || !owner) throw new Error("seeded trip or owner missing");
  const [seat] = await getTripRoster(db, shop.id, trip.id);
  if (!seat) throw new Error("seeded seat missing");
  const name = seat.person.fullName;
  let reached!: () => void;
  let release!: () => void;
  const buddyRead = new Promise<void>((resolve) => {
    reached = resolve;
  });
  latch.reached = reached;
  latch.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = readManifestPage(db, shop, trip.id, owner.id);
  try {
    await buddyRead;
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: seat.person.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);
  } finally {
    release();
    latch.wait = undefined;
    latch.reached = undefined;
  }
  const mixed = await reading;
  expect(JSON.stringify(mixed.completeManifests)).toContain(name);
  const liveEpoch = await getShopOfflineErasureEpoch(db, shop.id);
  if (mixed.renderErasureEpoch === null || liveEpoch === null)
    throw new Error("missing erasure epoch");
  const binding = {
    shopId: shop.id,
    tripId: trip.id,
    sessionId: "session-one",
    nonce: "22222222-2222-4222-8222-222222222222",
    renderId: "33333333-3333-4333-8333-333333333333",
    erasureEpoch: mixed.renderErasureEpoch,
    checkpoint: "departure",
  };
  const proof = signRosterConfirmation(binding);
  if (!proof) throw new Error("proof was not signed");
  expect(verifyRosterConfirmation({ ...binding, erasureEpoch: liveEpoch }, proof)).toBe(false);
  const fresh = await readManifestPage(db, shop, trip.id, owner.id);
  expect(fresh.renderErasureEpoch).toBe(liveEpoch);
  expect(JSON.stringify(fresh.completeManifests)).not.toContain(name);
  const freshBinding = { ...binding, erasureEpoch: liveEpoch };
  const freshProof = signRosterConfirmation(freshBinding);
  if (!freshProof) throw new Error("fresh proof was not signed");
  expect(verifyRosterConfirmation(freshBinding, freshProof)).toBe(true);
});
