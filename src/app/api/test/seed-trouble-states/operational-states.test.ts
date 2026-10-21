import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { departureBoatSafetySnapshot } from "@/db/boat-safety";
import { getTripManifest } from "@/db/manifests";
import { shops, trips } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { seedOperationalTrust } from "./operational-states";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { POST } = await import("./route");
const ctx = fileScopedShopContext();
const secret = "operational-fixture-secret";
const request = (query: string, authorization = `Bearer ${secret}`) =>
  new Request(`http://localhost/api/test/seed-trouble-states?${query}`, {
    method: "POST",
    headers: { authorization },
  });

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.mocked(getDb).mockResolvedValue(ctx.db);
});
afterEach(() => vi.unstubAllEnvs());

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

  it("accepts a test demo's chosen slug and rejects real shops, bad tokens, and real databases", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ slug: "operational-private-demo" }).where(eq(shops.id, shop.id));
    const seeded = await POST(request("operationalTrust=boat&shop=operational-private-demo"));
    expect(seeded.status).toBe(200);
    expect((await seeded.json()).operationalTrust.boatName).toBe("Trust I");
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    expect(
      (await POST(request("operationalTrust=boat&shop=operational-private-demo"))).status,
    ).toBe(404);
    expect((await POST(request("operationalTrust=boat", "Bearer wrong"))).status).toBe(404);
    vi.stubEnv("DATABASE_URL", "postgres://production.invalid/database");
    expect((await POST(request("operationalTrust=boat"))).status).toBe(404);
  });
});
