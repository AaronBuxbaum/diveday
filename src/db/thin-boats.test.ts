import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { bookings, courses, diveSites, people, shops, tripDives, trips } from "./schema";
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

  it("never offers past-site divers on a course session, and the deal only inside three days", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const [site] = await db.select().from(diveSites).where(eq(diveSites.shopId, shop.id)).limit(1);
    if (!site) throw new Error("the demo shop needs a dive site");
    const [course] = await db
      .insert(courses)
      .values({
        shopId: shop.id,
        title: "Open Water",
        slug: `thin-ow-${now.getTime()}`,
        agency: "PADI",
        certifiesLevel: "open_water",
      })
      .returning();
    const insert = async (
      title: string,
      days: number,
      extra: Partial<typeof trips.$inferInsert>,
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
      await db.insert(tripDives).values({ tripId: row.id, diveNumber: 1, diveSiteId: site.id });
      return row;
    };
    const session = await insert("Thin OW session", 2, { courseId: course.id });
    const funDive = await insert("Thin fun dive", 6, {});

    const { shown } = await listThinBoats(db, shop.id, now, 1000);
    expect(shown.find((boat) => boat.tripId === session.id)).toMatchObject({
      isCourseSession: true,
      invitesPastDivers: false,
      dealOpen: true,
    });
    expect(shown.find((boat) => boat.tripId === funDive.id)).toMatchObject({
      isCourseSession: false,
      invitesPastDivers: true,
      dealOpen: false,
    });

    // The deal is the last-minute list's door: switched off, no boat offers it.
    await db.update(shops).set({ lastMinuteListEnabled: false }).where(eq(shops.id, shop.id));
    const off = await listThinBoats(db, shop.id, now, 1000);
    expect(off.shown.find((boat) => boat.tripId === session.id)?.dealOpen).toBe(false);

    // The invite is past-diver invites' door: switched off, no boat offers it.
    await db.update(shops).set({ pastDiverInvitesEnabled: false }).where(eq(shops.id, shop.id));
    const noInvites = await listThinBoats(db, shop.id, now, 1000);
    expect(noInvites.shown.find((boat) => boat.tripId === funDive.id)?.invitesPastDivers).toBe(
      false,
    );
  });
});
