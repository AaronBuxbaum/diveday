// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";

describe("shop queries (in-memory PGlite)", () => {
  it("seeds a shop retrievable by slug", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    expect(shop?.name).toBe("Blue Mantis Divers");
    expect(shop?.timezone).toBe("America/New_York");
  });
});
