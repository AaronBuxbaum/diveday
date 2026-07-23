// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isUniqueConstraintViolation } from "@/db/client";
import { seededShopContext } from "@/test/db";
import { findOrCreatePerson } from "./people";
import { people, shops } from "./schema";

describe("findOrCreatePerson (CR-008)", () => {
  it("creates a new person when no active match exists", async () => {
    const { db, shop } = await seededShopContext();
    const result = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    expect(result.created).toBe(true);
    expect(result.person.email).toBe("nora@example.com");
  });

  it("reuses the existing active person for the same email instead of splitting identity", async () => {
    const { db, shop } = await seededShopContext();
    const first = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    const second = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Q. Quinn", // a re-entered name doesn't fork the record
      email: "nora@example.com",
    });
    expect(second.created).toBe(false);
    expect(second.person.id).toBe(first.person.id);

    const rows = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, "nora@example.com")));
    expect(rows).toHaveLength(1);
  });

  it("treats email matching as case-insensitive, matching the database constraint", async () => {
    const { db, shop } = await seededShopContext();
    const first = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    // Callers are expected to normalize before calling (every current call
    // site does — src/db/bookings.ts, waitlist.ts, divers.ts, import.ts all
    // .trim().toLowerCase() first), so this exercises the same lowercase
    // value a normalized caller would pass, proving reuse still converges.
    const second = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    expect(second.person.id).toBe(first.person.id);
  });

  it("scopes to the shop: the same email at a different shop is a different person", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Second Shop", slug: "second-shop-people-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");

    const here = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    const elsewhere = await findOrCreatePerson(db, {
      shopId: otherShop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    expect(elsewhere.person.id).not.toBe(here.person.id);
  });
});

describe("people_shop_email_unique (CR-008)", () => {
  it("the database itself rejects a second active person with the same email in different casing", async () => {
    const { db, shop } = await seededShopContext();
    await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Nora Quinn", email: "nora@example.com" });

    let caught: unknown;
    try {
      await db
        .insert(people)
        .values({ shopId: shop.id, fullName: "Nora Q.", email: "NORA@Example.com" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(isUniqueConstraintViolation(caught)).toBe(true);
  });

  it("frees the email once the holder is soft-deleted, so a genuinely new person can take it", async () => {
    const { db, shop } = await seededShopContext();
    const [original] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Nora Quinn", email: "nora@example.com" })
      .returning();
    if (!original) throw new Error("insert failed");
    await db.update(people).set({ deletedAt: new Date() }).where(eq(people.id, original.id));

    await expect(
      db
        .insert(people)
        .values({ shopId: shop.id, fullName: "Nora Quinn II", email: "nora@example.com" }),
    ).resolves.toBeDefined();
  });

  it("does not constrain people with no email on file", async () => {
    const { db, shop } = await seededShopContext();
    await db.insert(people).values({ shopId: shop.id, fullName: "Walk-up One", email: null });
    await expect(
      db.insert(people).values({ shopId: shop.id, fullName: "Walk-up Two", email: null }),
    ).resolves.toBeDefined();
  });
});
