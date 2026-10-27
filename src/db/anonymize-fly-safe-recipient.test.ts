import { and, eq, ne } from "drizzle-orm";
import { expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { recordFlySafeTold } from "./fly-safe-correction";
import { bookings, people, personRoles } from "./schema";

it("erases a sealed flying-advice recipient with the diver", async () => {
  const { db, shop } = await seededShopContext();
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [seat] = await db
    .select({ id: bookings.id, personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
    .limit(1);
  if (!owner || !seat) throw new Error("seed missing");
  await recordFlySafeTold(db, {
    shopId: shop.id,
    bookingId: seat.id,
    hours: 24,
    recipientEmail: "original@example.com",
  });
  await db
    .update(bookings)
    .set({
      flySafeAcknowledgementFingerprint: "a".repeat(64),
      flySafeAcknowledgedAt: new Date("2026-07-21T00:00:00Z"),
      flySafeAcknowledgedByPersonId: owner.id,
    })
    .where(eq(bookings.id, seat.id));
  const [before] = await db.select().from(bookings).where(eq(bookings.id, seat.id));
  expect(before?.flySafeRecipientSealed).not.toBeNull();
  expect(before?.flySafeRecipientSealed).not.toContain("original@example.com");
  expect(
    await anonymizeDiver(db, { shopId: shop.id, personId: seat.personId, actorPersonId: owner.id }),
  ).toMatchObject({ ok: true });
  const [after] = await db.select().from(bookings).where(eq(bookings.id, seat.id));
  expect(after?.flySafeRecipientSealed).toBeNull();
  expect(after?.flySafeAcknowledgementFingerprint).toBeNull();
  expect(after?.flySafeAcknowledgedAt).toBeNull();
  expect(after?.flySafeAcknowledgedByPersonId).toBeNull();
  // A provider completion can arrive after erasure; it must not restore the address.
  await recordFlySafeTold(db, {
    shopId: shop.id,
    bookingId: seat.id,
    hours: 24,
    recipientEmail: "original@example.com",
  });
  const [late] = await db.select().from(bookings).where(eq(bookings.id, seat.id));
  expect(late?.flySafeRecipientSealed).toBeNull();
});
