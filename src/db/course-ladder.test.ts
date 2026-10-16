import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { getCourseLadder, ladderInviteRefusal } from "./course-ladder";
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

    const ladder = await getCourseLadder(db, shop.id, now, shop.timezone);
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

  it("never names someone certified elsewhere, an imported card above the next level, or a minor under the next course's age", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const agency = "ladder-elig";
    const [taster, entry, advanced] = await db
      .insert(courses)
      .values([
        { shopId: shop.id, title: "Try It", slug: "elig-try", agency, isIntroCourse: true },
        {
          shopId: shop.id,
          title: "Entry",
          slug: "elig-ow",
          agency,
          certifiesLevel: "open_water",
          minimumAge: 10,
        },
        {
          shopId: shop.id,
          title: "Adult Advanced",
          slug: "elig-aow",
          agency,
          minimumCertificationLevel: "open_water",
          certifiesLevel: "advanced_open_water",
          minimumAge: 18,
        },
      ])
      .returning();
    const session = async (courseId: string, days: number) => {
      const startsAt = new Date(now.getTime() + days * DAY_MS);
      const [row] = await db
        .insert(trips)
        .values({
          shopId: shop.id,
          title: `Elig ${courseId} ${days}`,
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
    await session(entry.id, 12);
    const nextAdvanced = await session(advanced.id, 20);
    const named = ["Eve Elsewhere", "Fay Fresh", "Gus Imported", "Hal Minor", "Ida Adult"];
    const rows = await db
      .insert(people)
      .values(
        named.map((fullName, index) => ({
          shopId: shop.id,
          fullName,
          email: `${fullName.split(" ")[0].toLowerCase()}@elig.example`,
          dateOfBirth: index === 3 ? "2012-05-01" : null,
        })),
      )
      .returning();
    const [eve, fay, gus, hal, ida] = rows;
    await db
      .insert(personRoles)
      .values(rows.map((p) => ({ personId: p.id, role: "diver" as const })));
    // Eve and Fay tried diving here; Eve is certified Open Water with another agency.
    await db.insert(bookings).values(
      [eve, fay].map((p) => ({
        bookedAs: "diver" as const,
        shopId: shop.id,
        tripId: pastTaster.id,
        personId: p.id,
      })),
    );
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: eve.id,
      agency: "ssi",
      level: "open_water",
      status: "pending",
      identifier: "SSI-1",
    });
    // Gus, Hal and Ida certified Open Water here; Gus also has an imported Rescue card.
    await db.insert(certifications).values(
      [gus, hal, ida].map((p) => ({
        shopId: shop.id,
        personId: p.id,
        agency: "padi" as const,
        level: "open_water" as const,
        status: "verified" as const,
        issuedByShopAt: new Date(now.getTime() - 29 * DAY_MS),
        issuedFromTripId: pastEntry.id,
      })),
    );
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: gus.id,
      agency: "naui",
      level: "rescue",
      status: "verified",
      identifier: "NAUI-9",
      importedAt: now,
    });

    const ladder = await getCourseLadder(db, shop.id, now, shop.timezone);
    const names = (courseId: string) =>
      ladder.find((step) => step.course.id === courseId)?.stalled.map((p) => p.fullName);
    expect(names(taster.id)).toEqual(["Fay Fresh"]);
    expect(names(entry.id)).toEqual(["Ida Adult"]);

    // The action re-runs the same rule for a page left open.
    const refusal = (personId: string) =>
      ladderInviteRefusal(db, {
        shopId: shop.id,
        personId,
        tripId: nextAdvanced.id,
        timeZone: shop.timezone,
      });
    expect(await refusal(gus.id)).toBe("holds_next");
    expect(await refusal(hal.id)).toBe("under_age");
    expect(await refusal(ida.id)).toBeNull();
    expect(
      await ladderInviteRefusal(db, {
        shopId: shop.id,
        personId: ida.id,
        tripId: crypto.randomUUID(),
        timeZone: shop.timezone,
      }),
    ).toBe("not_a_course_session");
  });
});
