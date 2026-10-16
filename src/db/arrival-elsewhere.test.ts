import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { arrivalElsewhere } from "./arrival-elsewhere";
import { bookings, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

describe("arrivalElsewhere (fifth loop, item 12)", () => {
  it("names the person the desk typed and their next seat, wherever it sails", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const trips = await upcomingTripsWithCounts(db, shop.id, now);
    const later = trips.at(-1);
    if (!later) throw new Error("demo needs an upcoming trip");
    const [bjorn] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Bjorn Aasen", email: "bjorn@example.com" })
      .returning();
    if (!bjorn) throw new Error("no person");
    await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: later.id, personId: bjorn.id, bookedAs: "diver" });

    const [match] = await arrivalElsewhere(db, shop.id, "Bjorn", now);
    expect(match).toMatchObject({ personId: bjorn.id, fullName: "Bjorn Aasen" });
    expect(match?.next?.tripId).toBe(later.id);
  });

  it("says nobody is booked ahead, and answers nothing for a stray letter", async () => {
    const { db, shop } = ctx;
    await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Quentin Zabriskie", email: "qz@example.com" });
    const [match] = await arrivalElsewhere(db, shop.id, "Zabriskie", nowDate());
    expect(match?.next).toBeNull();
    expect(await arrivalElsewhere(db, shop.id, "Z", nowDate())).toEqual([]);
  });

  it("never reads another shop's people", async () => {
    const { db } = ctx;
    expect(await arrivalElsewhere(db, crypto.randomUUID(), "Priya", nowDate())).toEqual([]);
  });
});
