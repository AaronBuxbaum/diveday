import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { boardingObservations, people, shops } from "@/db/schema";
import {
  claimDraftReceipt,
  type DraftReceiptIntent,
} from "@/test/boarding-receipt-prototype/claim";
import { installDraftTable } from "@/test/boarding-receipt-prototype/table";
import { unseededTestDb } from "@/test/db";

it("keeps draft key claims scoped and rolls back an unavailable link", async () => {
  const db = await unseededTestDb();
  await installDraftTable(db);
  const [shop] = await db
    .insert(shops)
    .values({ name: "Receipt", slug: `receipt-${randomUUID()}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop missing");
  const [actor] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Staff" })
    .returning();
  if (!actor) throw new Error("actor missing");
  const [observation] = await db
    .insert(boardingObservations)
    .values({
      shopId: shop.id,
      bookingId: randomUUID(),
      tripId: randomUUID(),
      clientKey: randomUUID(),
      recordedByPersonId: actor.id,
    })
    .returning();
  if (!observation) throw new Error("observation missing");
  const input: DraftReceiptIntent = {
    shopId: shop.id,
    clientKey: randomUUID(),
    bookingId: observation.bookingId,
    tripId: observation.tripId,
    observationId: observation.id,
    originalActorId: actor.id,
    occurredAt: null,
    context: { kind: "asserted", generationId: randomUUID(), meetingId: randomUUID() },
  };
  expect(await claimDraftReceipt(db, { ...input, context: { kind: "legacy_unknown" } })).toEqual({
    kind: "unverifiable",
  });
  expect(await claimDraftReceipt(db, { ...input, clientKey: observation.clientKey })).toEqual({
    kind: "unverifiable",
  });
  expect(await claimDraftReceipt(db, { ...input, observationId: randomUUID() })).toEqual({
    kind: "unavailable",
  });
  expect((await db.execute(sql`select * from draft_boarding_receipt_claims`)).rows).toEqual([]);
  expect(await claimDraftReceipt(db, input)).toEqual({
    kind: "inserted",
    observationId: observation.id,
  });
  expect(await claimDraftReceipt(db, input)).toEqual({
    kind: "replayed",
    observationId: observation.id,
  });
  expect(await claimDraftReceipt(db, { ...input, bookingId: randomUUID() })).toEqual({
    kind: "key_reused",
  });
});
