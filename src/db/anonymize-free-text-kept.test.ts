import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { REDACTED_TEXT } from "@/lib/anonymization";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import {
  bookings,
  people,
  personRoles,
  reviewModerationEvents,
  tripChangeEvents,
  tripReviews,
  trips,
} from "./schema";

const ctx = fileScopedShopContext({ history: true });

/**
 * Erasure removes a person's own data only (owner, 2026-11-01, reversing issue
 * #2315): a departure title, a departure change value and a moderation note
 * that mention an erased diver are other people's words and survive; the notes
 * on the diver's own reviews still go.
 */
async function owner(db: AppDb, shopId: string) {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
    .limit(1);
  if (!row) throw new Error("expected the seeded owner");
  return row;
}

async function diver(db: AppDb, shopId: string, fullName: string) {
  const [row] = await db.insert(people).values({ shopId, fullName }).returning({ id: people.id });
  if (!row) throw new Error("fixture insert failed");
  await db.insert(personRoles).values({ personId: row.id, role: "diver" });
  return row;
}

async function departure(db: AppDb, shopId: string, title: string, isPrivate = false) {
  const startsAt = new Date("2026-11-20T13:00:00Z");
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 8,
      isPrivate,
    })
    .returning({ id: trips.id });
  if (!row) throw new Error("fixture insert failed");
  return row;
}

async function seat(db: AppDb, shopId: string, tripId: string, personId: string) {
  const [row] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId, personId })
    .returning({ id: bookings.id });
  if (!row) throw new Error("fixture insert failed");
  return row;
}

async function titleOf(db: AppDb, tripId: string) {
  const [row] = await db.select({ title: trips.title }).from(trips).where(eq(trips.id, tripId));
  return row?.title;
}

async function erase(db: AppDb, shopId: string, personId: string) {
  const actor = await owner(db, shopId);
  const result = await anonymizeDiver(db, { shopId, personId, actorPersonId: actor.id });
  expect(result.ok).toBe(true);
  return actor;
}

describe("anonymizeDiver — words other people wrote that mention the diver", () => {
  it("leaves a departure title naming them, public or private", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Ruth Abernathy");
    const publicTrip = await departure(db, shop.id, "Ruth Abernathy birthday dive");
    const privateTrip = await departure(db, shop.id, "Abernathy charter", true);
    await seat(db, shop.id, publicTrip.id, person.id);
    await seat(db, shop.id, privateTrip.id, person.id);

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, publicTrip.id)).toBe("Ruth Abernathy birthday dive");
    expect(await titleOf(db, privateTrip.id)).toBe("Abernathy charter");
    const [row] = await db
      .select({ name: people.fullName })
      .from(people)
      .where(eq(people.id, person.id));
    expect(row?.name).not.toContain("Abernathy");
  });

  it("leaves a moderation note on someone else's review, and redacts the one on their own", async () => {
    const { db, shop } = ctx;
    const actor = await owner(db, shop.id);
    const person = await diver(db, shop.id, "Teodor Halvorsen");
    const other = await diver(db, shop.id, "Mina Park");
    const trip = await departure(db, shop.id, "Reef morning");
    const ownSeat = await seat(db, shop.id, trip.id, person.id);
    const otherSeat = await seat(db, shop.id, trip.id, other.id);
    const [own, theirs] = await db
      .insert(tripReviews)
      .values([
        { shopId: shop.id, bookingId: ownSeat.id, tripId: trip.id, personId: person.id, rating: 2 },
        {
          shopId: shop.id,
          bookingId: otherSeat.id,
          tripId: trip.id,
          personId: other.id,
          rating: 1,
        },
      ])
      .returning({ id: tripReviews.id });
    if (!own || !theirs) throw new Error("fixture insert failed");
    const note = (reviewId: string, reasonNote: string) => ({
      shopId: shop.id,
      reviewId,
      action: "hidden" as const,
      reason: "other" as const,
      reasonNote,
      recordedByPersonId: actor.id,
    });
    const [onOwn, naming] = await db
      .insert(reviewModerationEvents)
      .values([
        note(own.id, "Rude about the crew"),
        note(theirs.id, "Blames Teodor Halvorsen by name"),
      ])
      .returning({ id: reviewModerationEvents.id });
    if (!onOwn || !naming) throw new Error("fixture insert failed");

    await erase(db, shop.id, person.id);

    const notes = new Map(
      (
        await db
          .select({ id: reviewModerationEvents.id, note: reviewModerationEvents.reasonNote })
          .from(reviewModerationEvents)
          .where(eq(reviewModerationEvents.shopId, shop.id))
      ).map((row) => [row.id, row.note]),
    );
    expect(notes.get(onOwn.id)).toBe(REDACTED_TEXT);
    expect(notes.get(naming.id)).toBe("Blames Teodor Halvorsen by name");
  });

  it("leaves a departure change value that names them", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Teodor Halvorsen");
    const trip = await departure(db, shop.id, "Reef morning");
    await seat(db, shop.id, trip.id, person.id);
    const afterValue = {
      label: "Teodor  Halvorsen's house",
      note: "Gate code 12",
      siteNames: "Halvorsen's Ledge\nMolasses Reef",
    };
    const [event] = await db
      .insert(tripChangeEvents)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        kind: "meeting_point",
        source: "shop",
        beforeValue: { label: "Dock 2" },
        afterValue,
      })
      .returning({ id: tripChangeEvents.id });
    if (!event) throw new Error("fixture insert failed");

    await erase(db, shop.id, person.id);

    const [row] = await db.select().from(tripChangeEvents).where(eq(tripChangeEvents.id, event.id));
    expect(row?.afterValue).toEqual(afterValue);
  });
});
