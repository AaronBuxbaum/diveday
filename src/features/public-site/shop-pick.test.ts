import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { shops, trips } from "../../db/schema/index";
import { nowDate } from "../../lib/clock";
import { seededShopContext } from "../../test/db";
import { pickChoices, readShopPick, setShopPick } from "./shop-pick";

async function freshShop() {
  const { db, shop } = await seededShopContext();
  const now = nowDate();
  const choices = await pickChoices(db, shop, now);
  const trip = choices.trips[0];
  const course = choices.courses[0];
  if (!trip || !course) throw new Error("the seeded shop has an upcoming trip and a course");
  const reload = async () => {
    const [row] = await db.select().from(shops).where(eq(shops.id, shop.id));
    if (!row) throw new Error("shop vanished");
    return row;
  };
  return { db, shop, now, trip, course, reload };
}

describe("a shop's pick", () => {
  it("features a departure, then a course in its place, then nothing", async () => {
    const { db, shop, now, trip, course, reload } = await freshShop();

    expect(await setShopPick(db, shop, { kind: "trip", id: trip.id }, now)).toBe(true);
    expect((await readShopPick(db, await reload(), now))?.kind).toBe("trip");

    expect(await setShopPick(db, shop, { kind: "course", id: course.id }, now)).toBe(true);
    const row = await reload();
    // One pick at a time: the course replaced the departure rather than joining it.
    expect(row.pickTripId).toBeNull();
    expect((await readShopPick(db, row, now))?.kind).toBe("course");

    expect(await setShopPick(db, shop, null, now)).toBe(true);
    expect(await readShopPick(db, await reload(), now)).toBeNull();
  });

  it("refuses a departure that is not this shop's, and a made-up id, changing nothing", async () => {
    const { db, shop, now, trip, reload } = await freshShop();
    await setShopPick(db, shop, { kind: "trip", id: trip.id }, now);

    const elsewhere = { ...shop, id: crypto.randomUUID() };
    expect(await setShopPick(db, elsewhere, { kind: "trip", id: trip.id }, now)).toBe(false);
    expect(await setShopPick(db, shop, { kind: "course", id: crypto.randomUUID() }, now)).toBe(
      false,
    );
    expect((await reload()).pickTripId).toBe(trip.id);
  });

  it("stops showing a departure that went private, without a cleanup", async () => {
    const { db, shop, now, trip, reload } = await freshShop();
    await setShopPick(db, shop, { kind: "trip", id: trip.id }, now);
    await db.update(trips).set({ isPrivate: true }).where(eq(trips.id, trip.id));

    expect(await readShopPick(db, await reload(), now)).toBeNull();
    // ...and it is no longer offered to pick again.
    const offered = await pickChoices(db, shop, now);
    expect(offered.trips.some((offeredTrip) => offeredTrip.id === trip.id)).toBe(false);
    expect(await setShopPick(db, shop, { kind: "trip", id: trip.id }, now)).toBe(false);
  });
});
