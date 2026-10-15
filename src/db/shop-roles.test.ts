import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { people, personRoles } from "./schema";
import { listShopRolesPresent } from "./shop-roles";

const ctx = fileScopedShopContext();

describe("the roles a shop's people hold (in-memory PGlite)", () => {
  it("names every role the demo shop seeded, once each", async () => {
    const { db, shop } = ctx;
    const roles = await listShopRolesPresent(db, shop.id);
    expect(roles.has("owner")).toBe(true);
    expect(roles.has("captain")).toBe(true);
  });

  it("is empty for a shop id that holds nobody", async () => {
    const { db } = ctx;
    expect((await listShopRolesPresent(db, "00000000-0000-0000-0000-000000000000")).size).toBe(0);
  });

  it("leaves out a role only removed people hold", async () => {
    const { db, shop } = ctx;
    const captains = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "captain")));
    expect(captains.length).toBeGreaterThan(0);
    await db
      .update(people)
      .set({ deletedAt: new Date("2026-10-01T12:00:00Z") })
      .where(
        inArray(
          people.id,
          captains.map((captain) => captain.id),
        ),
      );
    const roles = await listShopRolesPresent(db, shop.id);
    expect(roles.has("captain")).toBe(false);
    expect(roles.has("owner")).toBe(true);
  });
});
