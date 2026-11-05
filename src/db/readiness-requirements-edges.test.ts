import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getTripRequirements, listTripsReadiness, upsertTripRequirements } from "./readiness";
import { readinessFixturesFor } from "./readiness-test-fixtures";

const ctx = fileScopedShopContext();
const { readinessContext } = readinessFixturesFor(ctx);

const requirement: Parameters<typeof upsertTripRequirements>[1] = {
  shopId: "",
  tripId: "",
  requiresWaiver: true,
  minimumCertificationLevel: null,
  requiredSpecialties: [],
  requiresNitrox: false,
  requiresPayment: false,
};

describe("a trip's requirements at their edges", () => {
  it("writes nothing for a departure that does not exist", async () => {
    const { db, shop } = await readinessContext();
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(
      upsertTripRequirements(db, { ...requirement, shopId: shop.id, tripId: missing }),
    ).resolves.toBeNull();
    await expect(getTripRequirements(db, shop.id, missing)).resolves.toBeNull();
  });

  it("writes nothing through another shop's id for a real departure", async () => {
    const { db, reef } = await readinessContext();
    const stranger = "00000000-0000-4000-8000-000000000001";
    await expect(
      upsertTripRequirements(db, { ...requirement, shopId: stranger, tripId: reef.id }),
    ).resolves.toBeNull();
  });

  it("reads readiness for no departures as no rows", async () => {
    const { db, shop } = await readinessContext();
    await expect(listTripsReadiness(db, shop.id, [])).resolves.toEqual([]);
  });
});
