import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import type { AppDb } from "@/db/client";
import { boardingObservations, people, shops } from "@/db/schema";
import { inspectLegacyBoardingKeys } from "@/features/boarding-receipts";

/** The same real-schema inventory check runs on PGlite and PostgreSQL. */
export async function checkBoardingReconciliation(db: AppDb) {
  const suffix = randomUUID();
  const [shop] = await db
    .insert(shops)
    .values({ name: "One", slug: `one-${suffix}`, timezone: "UTC" })
    .returning();
  const [other] = await db
    .insert(shops)
    .values({ name: "Two", slug: `two-${suffix}`, timezone: "UTC" })
    .returning();
  if (!shop || !other) throw new Error("shops missing");
  const [actor] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "First" })
    .returning();
  const [otherActor] = await db
    .insert(people)
    .values({ shopId: other.id, fullName: "Second" })
    .returning();
  if (!actor || !otherActor) throw new Error("actors missing");
  const key = randomUUID();
  const [first, second] = await db
    .insert(boardingObservations)
    .values([
      {
        shopId: shop.id,
        bookingId: randomUUID(),
        tripId: randomUUID(),
        clientKey: key,
        recordedByPersonId: actor.id,
      },
      {
        shopId: shop.id,
        bookingId: randomUUID(),
        tripId: randomUUID(),
        clientKey: randomUUID(),
        recordedByPersonId: actor.id,
      },
    ])
    .returning();
  const [foreign] = await db
    .insert(boardingObservations)
    .values({
      shopId: other.id,
      bookingId: randomUUID(),
      tripId: randomUUID(),
      clientKey: key,
      recordedByPersonId: otherActor.id,
    })
    .returning();
  if (!first || !second || !foreign) throw new Error("observations missing");
  const receipt = (row: typeof first) => ({
    shopId: row.shopId,
    clientKey: row.clientKey,
    observationId: row.id,
    bookingId: row.bookingId,
    tripId: row.tripId,
    recordedByPersonId: row.recordedByPersonId,
  });
  const before = await db
    .select()
    .from(boardingObservations)
    .where(eq(boardingObservations.shopId, shop.id));
  const report = await db.transaction((tx) =>
    inspectLegacyBoardingKeys(tx, shop.id, [
      receipt(first),
      { ...receipt(second), tripId: randomUUID() },
      receipt(foreign),
      { ...receipt(first), clientKey: randomUUID() },
    ]),
  );
  expect(report).toEqual({
    storedOriginalKeys: 2,
    matchingSelectedFields: 1,
    missing: 0,
    conflicting: 1,
    duplicateProposedKeys: 0,
    unclassifiedReceiptKeys: 1,
    originalMeetingAndGeneration: "unknown",
    priorJoinedKeyCoverage: "unknown",
    writerDrain: "unverified",
    cutoverPermitted: false,
  });
  const duplicates = await db.transaction((tx) =>
    inspectLegacyBoardingKeys(tx, shop.id, [receipt(first), receipt(first)]),
  );
  expect(duplicates).toMatchObject({
    matchingSelectedFields: 0,
    missing: 1,
    conflicting: 1,
    duplicateProposedKeys: 1,
    cutoverPermitted: false,
  });
  for (const changed of [
    { ...receipt(first), bookingId: randomUUID() },
    { ...receipt(first), observationId: randomUUID() },
    { ...receipt(first), recordedByPersonId: randomUUID() },
  ]) {
    const mismatch = await db.transaction((tx) =>
      inspectLegacyBoardingKeys(tx, shop.id, [changed]),
    );
    expect(mismatch).toMatchObject({ conflicting: 1, missing: 1, cutoverPermitted: false });
  }
  const absentShop = await db.transaction((tx) =>
    inspectLegacyBoardingKeys(tx, randomUUID(), [receipt(first)]),
  );
  expect(absentShop).toMatchObject({
    storedOriginalKeys: 0,
    unclassifiedReceiptKeys: 0,
    priorJoinedKeyCoverage: "unknown",
    cutoverPermitted: false,
  });
  await expect(
    db.transaction((tx) =>
      inspectLegacyBoardingKeys(
        tx,
        shop.id,
        Array.from({ length: 10_001 }, () => receipt(first)),
      ),
    ),
  ).rejects.toThrow("Boarding key inventory is too large");
  const empty = await db.transaction((tx) => inspectLegacyBoardingKeys(tx, other.id, []));
  expect(empty).toMatchObject({
    storedOriginalKeys: 1,
    missing: 1,
    writerDrain: "unverified",
    cutoverPermitted: false,
  });
  const after = await db
    .select()
    .from(boardingObservations)
    .where(eq(boardingObservations.shopId, shop.id));
  expect(after.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    before.sort((a, b) => a.id.localeCompare(b.id)),
  );
}
