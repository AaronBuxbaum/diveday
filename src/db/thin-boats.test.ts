import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { bookings, people, trips } from "./schema";
import { listThinBoats } from "./thin-boats";

const ctx = fileScopedShopContext();

describe("listThinBoats", () => {
  it("lists public departures in the next two weeks that could use divers, soonest first", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const insert = async (
      title: string,
      days: number,
      extra: Partial<typeof trips.$inferInsert> = {},
    ) => {
      const startsAt = new Date(now.getTime() + days * DAY_MS);
      const [row] = await db
        .insert(trips)
        .values({
          shopId: shop.id,
          title,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
          capacity: 4,
          ...extra,
        })
        .returning();
      return row;
    };
    const far = await insert("Thin far boat", 13);
    const near = await insert("Thin near boat", 8, {
      minimumBookings: 3,
      minimumDecisionHours: 48,
    });
    const half = await insert("Half full boat", 9);
    const charter = await insert("Private charter", 10, { isPrivate: true });
    const beyond = await insert("Past the horizon", 20);
    const divers = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Thin One", email: "thin.one@thin-boats.example" },
        { shopId: shop.id, fullName: "Thin Two", email: "thin.two@thin-boats.example" },
      ])
      .returning();
    await db.insert(bookings).values(
      divers.map((diver) => ({
        bookedAs: "diver" as const,
        shopId: shop.id,
        tripId: half.id,
        personId: diver.id,
      })),
    );

    const { shown } = await listThinBoats(db, shop.id, now, 1000);
    const ids = shown.map((boat) => boat.tripId);
    expect(ids).toContain(far.id);
    expect(ids).toContain(near.id);
    expect(ids.indexOf(near.id)).toBeLessThan(ids.indexOf(far.id));
    for (const left of [half.id, charter.id, beyond.id]) expect(ids).not.toContain(left);
    expect(shown.find((boat) => boat.tripId === near.id)).toMatchObject({
      booked: 0,
      capacity: 4,
      need: { kind: "minimum", shortfall: 3 },
    });
    expect(shown.find((boat) => boat.tripId === far.id)?.need).toEqual({ kind: "seats" });
  });
});
