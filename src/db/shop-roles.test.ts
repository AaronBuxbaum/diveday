import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { listShopRolesPresent } from "./shop-roles";

describe("the roles a shop's people hold (in-memory PGlite)", () => {
  it("names every role the demo shop seeded, once each", async () => {
    const { db, shop } = await seededShopContext();
    const roles = await listShopRolesPresent(db, shop.id);
    expect(roles.has("owner")).toBe(true);
    expect(roles.has("captain")).toBe(true);
  });

  it("is empty for a shop id that holds nobody", async () => {
    const { db } = await seededShopContext();
    expect((await listShopRolesPresent(db, "00000000-0000-0000-0000-000000000000")).size).toBe(0);
  });
});
