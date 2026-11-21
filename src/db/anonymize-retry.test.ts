import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "../features/records/anonymize";
import { bookings, people, personRoles } from "./schema";

/**
 * A retried erasure reports success. The record's name is already redacted on
 * the second call, so the typed-name confirmation that guarded the first call
 * cannot match it, and must not turn a finished erasure into a refusal.
 */
const ctx = fileScopedShopContext();

describe("anonymizeDiver retried with its public confirmation", () => {
  it("reports the erasure as already done, not as a name mismatch", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    const [diver] = await db
      .select({ personId: bookings.personId, name: people.fullName })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
      .orderBy(bookings.id)
      .limit(1);
    if (!owner || !diver) throw new Error("expected a seeded owner and booking");
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, diver.personId));
    const input = {
      shopId: shop.id,
      personId: diver.personId,
      actorPersonId: owner.id,
      confirmation: { name: diver.name, requireDeleted: true as const },
    };
    expect(await anonymizeDiver(db, input)).toMatchObject({ ok: true, alreadyAnonymized: false });
    expect(await anonymizeDiver(db, input)).toMatchObject({ ok: true, alreadyAnonymized: true });
  });
});
