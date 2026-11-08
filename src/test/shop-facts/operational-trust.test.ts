import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { departureBoatSafetySnapshot } from "../../db/boat-safety";
import { getTripManifest } from "../../db/manifests";
import { trips } from "../../db/schema/index";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../db";
import { seedOperationalTrust } from "./operational-trust";

const ctx = fileScopedShopContext();

describe("operational trust trouble states", () => {
  it("seeds every passenger kind and counted crew exactly at the total limit", async () => {
    const { db, shop } = ctx;
    const state = await seedOperationalTrust(db, shop, "capacity", nowDate());
    const manifest = await getTripManifest(db, shop.id, state.tripId);
    expect(manifest?.divers.map((seat) => seat.participantType)).toEqual([
      "diver",
      "diver",
      "snorkeler",
      "rider",
    ]);
    expect(manifest?.divers.every((seat) => seat.rollCall?.state === "boarded")).toBe(true);
    expect(manifest?.divers.every((seat) => seat.readiness.status === "ready")).toBe(true);
    expect(manifest?.crew.filter((person) => person.rollCall?.state === "boarded")).toHaveLength(1);
    expect(manifest?.crew.find((person) => person.id === state.crewId)?.rollCall).toBeUndefined();
    expect(manifest?.trip.certifiedTotalPersons).toBe(5);
  });

  it("keeps a blocked junior in a hand-built team and names an ashore teammate", async () => {
    const { db, shop } = ctx;
    const state = await seedOperationalTrust(db, shop, "ashore", nowDate());
    const manifest = await getTripManifest(db, shop.id, state.tripId);
    const junior = manifest?.divers.find((seat) => seat.fullName === "Ari Vale");
    const adult = manifest?.divers.find((seat) => seat.fullName === "Bea Quill");
    expect(junior?.readiness.status).toBe("blocked");
    expect(junior?.rollCall?.state).toBe("not_boarded");
    expect(adult?.buddyAlert).toBe("teammate_ashore");
    expect(adult?.buddyTeam?.others.map((person) => person.fullName)).toEqual(["Ari Vale"]);
  });

  it("preserves the original hull's papers in a historical mismatch", async () => {
    const { db, shop } = ctx;
    const state = await seedOperationalTrust(db, shop, "historic", nowDate());
    expect(await departureBoatSafetySnapshot(db, shop.id, state.tripId)).toMatchObject({
      boatId: state.boatId,
      boatName: "Trust I",
      papers: { certifiedTotalPersons: 5 },
      radio: { callSign: "TRUST1" },
    });
    const [trip] = await db
      .select({ boatId: trips.boatId })
      .from(trips)
      .where(eq(trips.id, state.tripId));
    expect(trip?.boatId).toBe(state.replacementBoatId);
  });

  it("keeps two operational variants independent in the same private shop", async () => {
    const { db, shop } = ctx;
    const intro = await seedOperationalTrust(db, shop, "intro", nowDate());
    const ashore = await seedOperationalTrust(db, shop, "ashore", nowDate());
    expect(ashore.tripId).not.toBe(intro.tripId);
    const manifest = await getTripManifest(db, shop.id, ashore.tripId);
    expect(manifest?.divers.find((seat) => seat.fullName === "Bea Quill")?.buddyAlert).toBe(
      "teammate_ashore",
    );
  });
});
