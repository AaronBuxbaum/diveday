import { and, eq, inArray, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { people, rollCallEvents, tripAssignments, tripDives } from "../../db/schema/index";
import { listTripLostItems } from "../../features/lost-items/store";
import { listTripSightings } from "../../features/trip-sightings/store";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../db";
import { putABoatOnTheWater } from "./put-a-boat-on-the-water";

const ctx = fileScopedShopContext();

it("keeps the fixture captain as recorder under a different assignment read plan", async () => {
  const { db, shop } = ctx;
  const staff = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(eq(people.shopId, shop.id), inArray(people.fullName, ["Dana Reyes", "Keiko Tanaka"])),
    )
    .orderBy(people.id);
  const [firstId, lastId] = staff;
  if (!firstId || !lastId) throw new Error("Fixture needs two active staff");
  await db.update(people).set({ fullName: "A Fixture Captain" }).where(eq(people.id, lastId.id));
  await db
    .update(people)
    .set({ fullName: "B Fixture Divemaster" })
    .where(eq(people.id, firstId.id));
  // The role-aware fixture picks its captain by name; the assignment primary
  // key reads person IDs in the opposite order. No production reader is mocked.
  await db.execute(sql`set local enable_seqscan = off`);
  await db.execute(sql`set local enable_bitmapscan = off`);
  const { tripId } = await putABoatOnTheWater(db, shop, { state: "outstanding" }, nowDate());
  const [captain] = await db
    .select({ id: tripAssignments.personId })
    .from(tripAssignments)
    .where(and(eq(tripAssignments.tripId, tripId), eq(tripAssignments.tripRole, "captain")));
  expect(captain?.id).toBe(lastId.id);
  const marks = await db
    .select({ recorderId: rollCallEvents.recordedByPersonId })
    .from(rollCallEvents)
    .where(and(eq(rollCallEvents.tripId, tripId), eq(rollCallEvents.checkpoint, "after_dive_1")));
  expect(marks.length).toBeGreaterThan(0);
  expect(new Set(marks.map((mark) => mark.recorderId))).toEqual(new Set([lastId.id]));
});

it("puts a sighting at dive 1's site and a found item on the recorded departure", async () => {
  const { db, shop } = ctx;
  const { tripId } = await putABoatOnTheWater(db, shop, { state: "recorded" }, nowDate());
  const [sightings, found, [planned]] = await Promise.all([
    listTripSightings(db, shop.id, tripId),
    listTripLostItems(db, shop.id, tripId),
    db
      .select({ siteId: tripDives.diveSiteId })
      .from(tripDives)
      .where(and(eq(tripDives.tripId, tripId), eq(tripDives.diveNumber, 1))),
  ]);
  expect(new Set(sightings.map((row) => row.speciesSlug))).toEqual(
    new Set(["green-sea-turtle", "spotted-eagle-ray"]),
  );
  expect(sightings.every((row) => row.diveSiteId === planned?.siteId)).toBe(true);
  expect(found).toHaveLength(1);
});
