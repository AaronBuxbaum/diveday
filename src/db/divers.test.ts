// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { createDiver, getDiverProfile, listDiverSummaries, updateDiver } from "./divers";
import { saveRentalGearProfile } from "./gear-requests";
import { getShopBySlug } from "./queries";
import { seedDemo } from "./seed";

describe("person-first diver records", () => {
  it("composes cards, fit, and history from one diver record", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");

    const summaries = await listDiverSummaries(db, shop.id);
    const priya = summaries.find((row) => row.person.fullName === "Priya Sharma");
    expect(priya).toMatchObject({ certificationCount: 1, pendingCertificationCount: 0 });
    if (!priya) throw new Error("seed diver missing");

    const profile = await saveRentalGearProfile(db, {
      shopId: shop.id,
      personId: priya.person.id,
      bcdSize: "M",
      wetsuitSize: "3 mm / M",
      finSize: "L",
      weightPreference: "12 lb",
    });
    expect(profile).toMatchObject({ bcdSize: "M", wetsuitSize: "3 mm / M" });

    const detail = await getDiverProfile(db, shop.id, priya.person.id);
    expect(detail?.gearProfile).toMatchObject({ bcdSize: "M", finSize: "L" });
    expect(detail?.certifications).toHaveLength(1);
  });

  it("can add a returning diver before a booking and rejects staff-only records", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");

    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Returning Riley",
      email: "riley@example.com",
      phone: "+1 305 555 0199",
    });
    expect(diver).toMatchObject({ fullName: "Returning Riley", email: "riley@example.com" });
    if (!diver) throw new Error("diver insert failed");
    expect(
      await createDiver(db, {
        shopId: shop.id,
        fullName: "Duplicate Riley",
        email: "RILEY@example.com",
      }),
    ).toBeNull();

    const updated = await updateDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: "Returning Riley Updated",
      email: "riley@example.com",
      phone: "555",
    });
    expect(updated?.fullName).toBe("Returning Riley Updated");

    const staff = (await listDiverSummaries(db, shop.id)).find(
      (row) => row.person.fullName === "Dana Reyes",
    );
    expect(staff).toBeUndefined();
  });
});
