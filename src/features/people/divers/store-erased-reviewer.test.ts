import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cards, people, personRoles } from "../../../db/schema/index";
import { fileScopedShopContext } from "../../../test/db";
import { getDiverProfile } from "./store";

const ctx = fileScopedShopContext();

describe("a diver's certification cards", () => {
  it("does not name an erased staffer as a card's reviewer", async () => {
    const { db, shop } = ctx;
    const [diver] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "diver")))
      .limit(1);
    const [reviewer] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), ne(people.id, diver?.id ?? "")))
      .limit(1);
    if (!diver || !reviewer) throw new Error("seed has no diver and second person");
    await db.insert(cards).values({
      shopId: shop.id,
      personId: diver.id,
      kind: "level",
      agency: "padi",
      level: "open_water",
      identifier: "OW-1",
      status: "verified",
      reviewedByPersonId: reviewer.id,
      reviewedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const named = await getDiverProfile(db, shop.id, diver.id);
    expect(named?.certifications.find((c) => c.identifier === "OW-1")?.reviewedByName).toBeTruthy();
    await db
      .update(people)
      .set({
        anonymizedAt: new Date("2026-02-01T00:00:00Z"),
        deletedAt: new Date("2026-02-01T00:00:00Z"),
        fullName: "Erased person",
      })
      .where(eq(people.id, reviewer.id));
    const erased = await getDiverProfile(db, shop.id, diver.id);
    expect(erased?.certifications.find((c) => c.identifier === "OW-1")?.reviewedByName).toBeNull();
  });
});
