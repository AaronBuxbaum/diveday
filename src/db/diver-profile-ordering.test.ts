import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createDiver, getDiverProfile } from "./divers";
import { certifications, nitroxCertifications, specialtyCertifications } from "./schema";

const ctx = fileScopedShopContext();

describe("diver profile card ordering", () => {
  it("orders tied creation times deterministically and keeps newer cards first", async () => {
    const { db, shop } = ctx;
    const diver = await createDiver(db, { shopId: shop.id, fullName: "Tied card diver" });
    if (!diver) throw new Error("could not create diver");
    const tiedAt = new Date("2026-10-28T12:00:00.000Z");
    const newestAt = new Date("2026-10-28T12:01:00.000Z");

    await db.insert(certifications).values([
      {
        id: "00000000-0000-4000-8000-000000000102",
        shopId: shop.id,
        personId: diver.id,
        agency: "ssi",
        level: "open_water",
        identifier: "B",
        createdAt: tiedAt,
      },
      {
        id: "00000000-0000-4000-8000-000000000101",
        shopId: shop.id,
        personId: diver.id,
        agency: "gue",
        level: "open_water",
        identifier: "A",
        createdAt: tiedAt,
      },
      {
        id: "00000000-0000-4000-8000-000000000103",
        shopId: shop.id,
        personId: diver.id,
        agency: "padi",
        level: "rescue",
        identifier: "NEW",
        createdAt: newestAt,
      },
    ]);
    await db.insert(specialtyCertifications).values([
      {
        id: "00000000-0000-4000-8000-000000000202",
        shopId: shop.id,
        personId: diver.id,
        agency: "ssi",
        specialty: "deep",
        identifier: "B",
        createdAt: tiedAt,
      },
      {
        id: "00000000-0000-4000-8000-000000000201",
        shopId: shop.id,
        personId: diver.id,
        agency: "gue",
        specialty: "deep",
        identifier: "A",
        createdAt: tiedAt,
      },
      {
        id: "00000000-0000-4000-8000-000000000203",
        shopId: shop.id,
        personId: diver.id,
        agency: "padi",
        specialty: "wreck",
        identifier: "NEW",
        createdAt: newestAt,
      },
    ]);
    await db.insert(nitroxCertifications).values([
      {
        id: "00000000-0000-4000-8000-000000000302",
        shopId: shop.id,
        personId: diver.id,
        agency: "ssi",
        identifier: "B",
        createdAt: tiedAt,
      },
      {
        id: "00000000-0000-4000-8000-000000000301",
        shopId: shop.id,
        personId: diver.id,
        agency: "gue",
        identifier: "A",
        createdAt: tiedAt,
      },
      {
        id: "00000000-0000-4000-8000-000000000303",
        shopId: shop.id,
        personId: diver.id,
        agency: "padi",
        identifier: "NEW",
        createdAt: newestAt,
      },
    ]);

    const first = await getDiverProfile(db, shop.id, diver.id);
    const second = await getDiverProfile(db, shop.id, diver.id);
    expect(first?.certifications.map(({ id }) => id)).toEqual([
      "00000000-0000-4000-8000-000000000103",
      "00000000-0000-4000-8000-000000000102",
      "00000000-0000-4000-8000-000000000101",
    ]);
    expect(first?.specialtyCertifications.map(({ id }) => id)).toEqual([
      "00000000-0000-4000-8000-000000000203",
      "00000000-0000-4000-8000-000000000202",
      "00000000-0000-4000-8000-000000000201",
    ]);
    expect(first?.nitroxCertifications.map(({ id }) => id)).toEqual([
      "00000000-0000-4000-8000-000000000303",
      "00000000-0000-4000-8000-000000000302",
      "00000000-0000-4000-8000-000000000301",
    ]);
    expect(second?.certifications.map(({ id }) => id)).toEqual(
      first?.certifications.map(({ id }) => id),
    );
    expect(second?.specialtyCertifications.map(({ id }) => id)).toEqual(
      first?.specialtyCertifications.map(({ id }) => id),
    );
    expect(second?.nitroxCertifications.map(({ id }) => id)).toEqual(
      first?.nitroxCertifications.map(({ id }) => id),
    );
  });
});
