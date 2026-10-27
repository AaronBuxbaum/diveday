import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { shopDayBounds } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { recordDeskEvent } from "./desk-events";
import { people, personRoles, trips } from "./schema";
import {
  acknowledgeTodayCatchUp,
  initializeTodayCatchUp,
  readTodayCatchUp,
} from "./today-catch-up";

const ctx = fileScopedShopContext();

async function fixture() {
  const { db, shop } = ctx;
  const now = nowDate();
  const day = shopDayBounds(now, shop.timezone);
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shop.id),
        isNull(trips.deletedAt),
        gte(trips.startsAt, day.from),
        lt(trips.startsAt, day.to),
      ),
    )
    .limit(1);
  const staff = await db
    .select({ id: people.id, role: personRoles.role })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), isNull(people.deletedAt)));
  const reader = staff.find((row) => row.role === "owner");
  const other = staff.find((row) => row.role === "instructor" && row.id !== reader?.id);
  if (!trip || !reader || !other) throw new Error("today fixture needs a trip and two staff");
  return { db, shop, trip, reader, other, now };
}

describe("Today catch-up", () => {
  it("starts with a first-view snapshot, then reports only new acts for each reader", async () => {
    const { db, shop, trip, reader, other, now } = await fixture();
    const input = { shopId: shop.id, personId: reader.id, now, timeZone: shop.timezone };
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "plan_changed",
      actorPersonId: other.id,
    });
    const first = await readTodayCatchUp(db, input);
    expect(first.mark).toBeNull();
    expect(first.events).toEqual([]);
    expect(first.snapshotIds).toHaveLength(1);
    expect(await initializeTodayCatchUp(db, { ...input, eventIds: first.snapshotIds })).toBe(true);
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "meeting_point",
      actorPersonId: other.id,
    });
    const unread = await readTodayCatchUp(db, input);
    expect(unread.events.map((event) => event.kind)).toEqual(["meeting_point"]);
    expect((await readTodayCatchUp(db, { ...input, personId: other.id })).mark).toBeNull();
    await acknowledgeTodayCatchUp(db, { ...input, eventIds: unread.snapshotIds });
    expect((await readTodayCatchUp(db, input)).events).toEqual([]);
  });

  it("does not acknowledge an event that arrives after the displayed snapshot", async () => {
    const { db, shop, trip, reader, other, now } = await fixture();
    const input = { shopId: shop.id, personId: reader.id, now, timeZone: shop.timezone };
    await initializeTodayCatchUp(db, { ...input, eventIds: [] });
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "plan_changed",
      actorPersonId: other.id,
    });
    const visible = await readTodayCatchUp(db, input);
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "meeting_point",
      actorPersonId: other.id,
    });
    await acknowledgeTodayCatchUp(db, { ...input, eventIds: visible.snapshotIds });
    expect((await readTodayCatchUp(db, input)).events.map((event) => event.kind)).toEqual([
      "meeting_point",
    ]);
  });
});
