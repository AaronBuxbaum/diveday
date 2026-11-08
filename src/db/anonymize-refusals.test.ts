import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "../features/anonymize/store";
import { bookings, people, personRoles } from "./schema";

/**
 * **What an erasure refuses before it scrubs anything** (issue #3832): an
 * actor who may not erase, a record that is not this shop's, a staff member,
 * and a public confirmation that does not match.
 * Each refusal leaves the record exactly as it was.
 */
const ctx = fileScopedShopContext();

async function setting() {
  const { db, shop } = ctx;
  const roleOf = async (role: "owner" | "instructor" | "divemaster" | "captain") => {
    const [row] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, role)))
      .limit(1);
    return row?.id;
  };
  const owner = await roleOf("owner");
  if (!owner) throw new Error("expected the seeded owner");
  const [diver] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
    .orderBy(bookings.id)
    .limit(1);
  if (!diver) throw new Error("expected a seeded booking");
  return { db, shop, owner, diver: diver.personId, roleOf };
}

async function nameOf(db: typeof ctx.db, personId: string) {
  const [row] = await db
    .select({ fullName: people.fullName, anonymizedAt: people.anonymizedAt })
    .from(people)
    .where(eq(people.id, personId));
  return row;
}

describe("anonymizeDiver refusals", () => {
  it("refuses an actor who is not staff of the shop, and leaves the record", async () => {
    const { db, shop, diver } = await setting();
    const before = await nameOf(db, diver);
    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: diver, actorPersonId: diver }),
    ).toMatchObject({ ok: false });
    expect(await nameOf(db, diver)).toEqual(before);
  });

  it("refuses a record that is not this shop's", async () => {
    const { db, shop, owner } = await setting();
    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: crypto.randomUUID(),
        actorPersonId: owner,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a public confirmation on a record not yet deleted, or under another name", async () => {
    const { db, shop, owner, diver } = await setting();
    const before = await nameOf(db, diver);
    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver,
        actorPersonId: owner,
        confirmation: { name: before?.fullName ?? "", requireDeleted: true },
      }),
    ).toEqual({ ok: false, reason: "requires_delete" });
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, diver));
    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver,
        actorPersonId: owner,
        confirmation: { name: "Somebody Else", requireDeleted: true },
      }),
    ).toEqual({ ok: false, reason: "name_mismatch" });
    await db.update(people).set({ deletedAt: null }).where(eq(people.id, diver));
    expect(await nameOf(db, diver)).toEqual(before);
  });

  it("refuses to erase a staff member", async () => {
    const { db, shop, owner, roleOf } = await setting();
    const crew = (await roleOf("divemaster")) ?? (await roleOf("instructor"));
    if (!crew) throw new Error("expected seeded crew");
    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: crew, actorPersonId: owner }),
    ).toEqual({ ok: false, reason: "staff_member" });
  });
});
