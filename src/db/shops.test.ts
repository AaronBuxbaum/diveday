// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seededTestDb } from "@/test/db";
import { getShopBySlug } from "./shops";

describe("shop queries (in-memory PGlite)", () => {
  it("seeds a shop retrievable by slug", async () => {
    const db = await seededTestDb();
    const shop = await getShopBySlug(db, "blue-mantis");
    expect(shop?.name).toBe("Blue Mantis Divers");
    expect(shop?.timezone).toBe("America/New_York");
  });
});
