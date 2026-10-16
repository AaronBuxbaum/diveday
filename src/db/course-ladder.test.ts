import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { getCourseLadder } from "./course-ladder";
import { bookings, certifications, courses, people, personRoles, trips } from "./schema";

const ctx = fileScopedShopContext();

describe("getCourseLadder", () => {
  it("counts who finished a course here, who went on, and names the rest beside the next session", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const agency = "ladder-test";
    const [taster, entry, advanced] = await db
      .insert(courses)
      .values([
        { shopId: shop.id, title: "Try Diving", slug: "ladder-try", agency, isIntroCourse: true },
        {
          shopId: shop.id,
          title: "Open Water",
          slug: "ladder-ow",
          agency,
          certifiesLevel: "open_water",
        },
        {
          shopId: shop.id,
          title: "Advanced",
          slug: "ladder-aow",
          agency,
          minimumCertificationLevel: "open_water",
          certifiesLevel: "advanced_open_water",
        },
      ])
      .returning();
    const session = async (courseId: string, days: number) => {
      const startsAt = new Date(now.getTime() + days * DAY_MS);
      const [row] = await db
        .insert(trips)
        .values({
          shopId: shop.id,
          title: `Session ${courseId} ${days}`,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
          capacity: 6,
          courseId,
        })
        .returning();
      return row;
    };
    const pastTaster = await session(taster.id, -60);
    const pastEntry = await session(entry.id, -30);
    const nextEntry = await session(entry.id, 12);
    const nextAdvanced = await session(advanced.id, 20);

    const people_ = await db
      .insert(people)
      .values(
        ["Ana Went", "Bo Stayed", "Cy Carded", "Di Carded"].map((fullName) => ({
          shopId: shop.id,
          fullName,
          email: `${fullName.split(" ")[0].toLowerCase()}@ladder.example`,
        })),
      )
      .returning();
    const [ana, bo, cy, di] = people_;
    await db
      .insert(personRoles)
      .values(people_.map((p) => ({ personId: p.id, role: "diver" as const })));
    const seat = (tripId: string, personId: string) => ({
      bookedAs: "diver" as const,
      shopId: shop.id,
      tripId,
      personId,
    });
    await db
      .insert(bookings)
      .values([
        seat(pastTaster.id, ana.id),
        seat(pastTaster.id, bo.id),
        seat(nextEntry.id, ana.id),
      ]);
    const [staff] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Ladder Instructor",
        email: "instructor@ladder.example",
      })
      .returning();
    await db.insert(certifications).values(
      [cy, di].map((p) => ({
        shopId: shop.id,
        personId: p.id,
        agency: "padi" as const,
        level: "open_water" as const,
        status: "verified" as const,
        issuedByShopAt: new Date(now.getTime() - 29 * DAY_MS),
        issuedFromTripId: pastEntry.id,
        issuedByPersonId: staff.id,
      })),
    );
    await db.insert(bookings).values(seat(nextAdvanced.id, di.id));

    const ladder = await getCourseLadder(db, shop.id, now);
    const tasterStep = ladder.find((step) => step.course.id === taster.id);
    expect(tasterStep).toMatchObject({
      kind: "taster",
      count: 2,
      wentOn: 1,
      next: { id: entry.id, title: "Open Water" },
      stalled: [{ fullName: "Bo Stayed", invitable: true }],
      nextSession: { tripId: nextEntry.id, booked: 1, capacity: 6 },
    });
    const entryStep = ladder.find((step) => step.course.id === entry.id);
    expect(entryStep).toMatchObject({
      kind: "certified",
      count: 2,
      wentOn: 1,
      next: { id: advanced.id },
      stalled: [{ fullName: "Cy Carded" }],
      nextSession: { tripId: nextAdvanced.id },
    });
    expect(ladder.find((step) => step.course.id === advanced.id)).toBeUndefined();
  });
});
