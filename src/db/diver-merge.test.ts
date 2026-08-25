import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import {
  listDiverMergeCandidates,
  listDiverMergeDuplicateIds,
  mergeDiverRecords,
} from "./diver-merge";
import {
  activityEvents,
  bookings,
  certifications,
  internalNotes,
  people,
  personRoles,
  priorVisits,
  rentalFitProfiles,
  trips,
} from "./schema";

async function mergeFixtures() {
  const { db, shop } = await seededShopContext();
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!owner || !trip) throw new Error("merge fixture needs the seeded owner and a trip");

  const [source, survivor] = await db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Maya Rivera", phone: "+1 (305) 555-0142" },
      { shopId: shop.id, fullName: "Maya Rivera", email: "maya@example.com" },
    ])
    .returning();
  if (!source || !survivor) throw new Error("merge fixture people insert failed");
  await db.insert(personRoles).values([
    { personId: source.id, role: "diver" },
    { personId: survivor.id, role: "diver" },
  ]);
  return { db, shop, owner, trip, source, survivor };
}

describe("diver record merge", () => {
  it("surfaces narrow same-name and same-phone candidates", async () => {
    const { db, shop, source, survivor } = await mergeFixtures();
    const candidates = await listDiverMergeCandidates(db, shop.id, source.id);
    expect(candidates.find((candidate) => candidate.id === survivor.id)).toEqual(
      expect.objectContaining({ id: survivor.id, reasons: ["same_name"] }),
    );
    expect(await listDiverMergeDuplicateIds(db, shop.id)).toEqual(
      expect.arrayContaining([source.id, survivor.id]),
    );

    const [phoneMatch] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Jules Other", phone: "+1 305 555 0142" })
      .returning();
    if (!phoneMatch) throw new Error("phone candidate insert failed");
    await db.insert(personRoles).values({ personId: phoneMatch.id, role: "diver" });
    const withPhone = await listDiverMergeCandidates(db, shop.id, source.id);
    expect(withPhone.find((candidate) => candidate.id === phoneMatch.id)?.reasons).toContain(
      "same_phone",
    );
  });

  it("moves diver history atomically and leaves activity subjects on the original id", async () => {
    const { db, shop, owner, trip, source, survivor } = await mergeFixtures();
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: source.id,
      agency: "padi",
      level: "open_water",
      identifier: "MAYA-OW-1",
      status: "verified",
    });
    await db.insert(rentalFitProfiles).values({
      shopId: shop.id,
      personId: source.id,
      bcdSize: "M",
    });
    await db.insert(priorVisits).values({
      shopId: shop.id,
      personId: source.id,
      visitedOn: "2025-05-02",
      title: "Reef day",
      dedupeKey: "prior-maya-1",
      importedAt: new Date("2025-05-03T00:00:00.000Z"),
    });
    const [booking] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: source.id })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("booking fixture insert failed");
    await db.insert(internalNotes).values({
      shopId: shop.id,
      personId: source.id,
      bookingId: booking.id,
      body: "Bring the smaller BCD.",
      createdByPersonId: owner.id,
    });
    await db.insert(activityEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      actorPersonId: owner.id,
      subjectPersonId: source.id,
      message: "A note was added.",
      occurredAt: new Date("2026-08-25T00:00:00.000Z"),
    });

    const result = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(result).toEqual({ ok: true, survivorId: survivor.id, mergedPersonId: source.id });

    expect(
      (await db.select().from(certifications).where(eq(certifications.personId, survivor.id))).map(
        (row) => row.identifier,
      ),
    ).toEqual(["MAYA-OW-1"]);
    expect(
      (
        await db.select().from(rentalFitProfiles).where(eq(rentalFitProfiles.personId, survivor.id))
      ).map((row) => row.bcdSize),
    ).toEqual(["M"]);
    expect(
      (await db.select().from(priorVisits).where(eq(priorVisits.personId, survivor.id))).map(
        (row) => row.dedupeKey,
      ),
    ).toEqual(["prior-maya-1"]);
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]?.personId).toBe(
      survivor.id,
    );
    expect(
      (await db.select().from(internalNotes).where(eq(internalNotes.personId, survivor.id))).length,
    ).toBe(1);
    expect(
      (await db.select().from(activityEvents).where(eq(activityEvents.bookingId, booking.id)))[0]
        ?.subjectPersonId,
    ).toBe(source.id);

    const [merged] = await db.select().from(people).where(eq(people.id, source.id));
    expect(merged).toMatchObject({
      deletedAt: expect.any(Date),
      mergedIntoPersonId: survivor.id,
      mergedByPersonId: owner.id,
      mergedAt: expect.any(Date),
    });
  });

  it("refuses a shared trip, anonymized source, and unauthorized actor without moving rows", async () => {
    const { db, shop, owner, trip, source, survivor } = await mergeFixtures();
    await db.insert(bookings).values([
      { shopId: shop.id, tripId: trip.id, personId: source.id },
      { shopId: shop.id, tripId: trip.id, personId: survivor.id },
    ]);
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "booking_conflict" });

    const [sourceAfterConflict] = await db.select().from(people).where(eq(people.id, source.id));
    expect(sourceAfterConflict?.mergedIntoPersonId).toBeNull();

    await db
      .update(people)
      .set({ deletedAt: new Date("2026-08-25T00:00:00.000Z"), anonymizedAt: nowDate() })
      .where(eq(people.id, source.id));
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "anonymized" });
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: source.id,
      }),
    ).toEqual({ ok: false, reason: "not_authorized" });
  });
});
