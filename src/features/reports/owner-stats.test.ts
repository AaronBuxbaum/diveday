import { describe, expect, it } from "vitest";
import type { AppDb } from "../../db/client";
import {
  bookings,
  cards,
  courses,
  interests,
  people,
  trips,
  waiverRecords,
} from "../../db/schema/index";
import { getCurrentWaiverTemplate } from "../../db/waivers";
import { fileScopedShopContext } from "../../test/db";
import { readOwnerStats } from "./owner-stats";

// One seeded database for the file and a rolled-back transaction per test. Every row here sits in
// 2020, a year the seed never reaches, and each read is dated 2021-01-01.
const ctx = fileScopedShopContext();

const NOW = new Date("2021-01-01T12:00:00Z");
const TZ = "UTC";
const HOUR = 3_600_000;

async function person(db: AppDb, shopId: string, name: string): Promise<string> {
  const [row] = await db.insert(people).values({ shopId, fullName: name }).returning();
  if (!row) throw new Error("person");
  return row.id;
}

async function trip(
  db: AppDb,
  shopId: string,
  startsAt: string,
  extra: { courseId?: string; status?: "scheduled" | "cancelled" } = {},
): Promise<{ id: string; startsAt: Date }> {
  const start = new Date(startsAt);
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Reef",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3 * HOUR),
      capacity: 10,
      ...extra,
    })
    .returning();
  if (!row) throw new Error("trip");
  return { id: row.id, startsAt: start };
}

async function seat(
  db: AppDb,
  shopId: string,
  tripId: string,
  personId: string,
  status: "booked" | "cancelled" | "no_show" = "booked",
): Promise<string> {
  const [row] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId, personId, status })
    .returning();
  if (!row) throw new Error("booking");
  return row.id;
}

async function waiver(
  db: AppDb,
  shopId: string,
  personId: string,
  signedAt: Date,
  extra: Partial<typeof waiverRecords.$inferInsert> = {},
): Promise<void> {
  const template = await getCurrentWaiverTemplate(db, shopId);
  if (!template) throw new Error("template");
  await db.insert(waiverRecords).values({
    shopId,
    personId,
    templateId: template.id,
    templateTitle: template.title,
    templateVersion: template.version,
    templateBody: template.body,
    status: "completed",
    signedAt,
    completedAt: signedAt,
    ...extra,
  });
}

describe("readOwnerStats", () => {
  it("reads zeros and nulls for a shop with nothing in the window", async () => {
    const { db, shop } = ctx;
    const stats = await readOwnerStats(db, shop.id, { now: NOW, timeZone: TZ });
    expect(stats).toEqual({
      repeat: { divers: 0, repeat: 0 },
      courses: [],
      medical: { cleared: 0, medianHours: null, waiting: 0 },
      waivers: { seats: 0, signedByDeparture: 0 },
      departures: { counted: 0, ready: 0 },
    });
  });

  it("counts a repeat diver once per diver, from active seats on departures that sailed", async () => {
    const { db, shop } = ctx;
    const [ana, ben, cy] = await Promise.all(
      ["Ana", "Ben", "Cy"].map((name) => person(db, shop.id, name)),
    );
    if (!ana || !ben || !cy) throw new Error("people");
    const a = await trip(db, shop.id, "2020-03-01T09:00:00Z");
    const b = await trip(db, shop.id, "2020-04-01T09:00:00Z");
    const future = await trip(db, shop.id, "2021-02-01T09:00:00Z");
    const cancelledTrip = await trip(db, shop.id, "2020-05-01T09:00:00Z", { status: "cancelled" });
    await seat(db, shop.id, a.id, ana);
    await seat(db, shop.id, b.id, ana);
    await seat(db, shop.id, a.id, ben);
    await seat(db, shop.id, b.id, ben, "cancelled");
    // Cy's second seat is on a departure that has not sailed.
    await seat(db, shop.id, a.id, cy);
    await seat(db, shop.id, future.id, cy);
    await seat(db, shop.id, cancelledTrip.id, cy);

    const { repeat } = await readOwnerStats(db, shop.id, { now: NOW, timeZone: TZ });
    expect(repeat).toEqual({ divers: 3, repeat: 1 });
  });

  it("measures waivers by the departure and fully-ready departures by the day before", async () => {
    const { db, shop } = ctx;
    const [ana, ben, cy] = await Promise.all(
      ["Ana", "Ben", "Cy"].map((name) => person(db, shop.id, name)),
    );
    if (!ana || !ben || !cy) throw new Error("people");
    const ready = await trip(db, shop.id, "2020-06-10T09:00:00Z");
    const late = await trip(db, shop.id, "2020-06-11T09:00:00Z");
    const empty = await trip(db, shop.id, "2020-06-12T09:00:00Z");
    await seat(db, shop.id, ready.id, ana);
    await seat(db, shop.id, late.id, ben);
    await seat(db, shop.id, late.id, cy);
    void empty;
    // Ana signed the week before. Ben signed on the dock, one hour before the boat left.
    await waiver(db, shop.id, ana, new Date("2020-06-03T10:00:00Z"));
    await waiver(db, shop.id, ben, new Date("2020-06-11T08:00:00Z"));
    // Cy's only release was replaced by a newer one that nobody has signed.
    await waiver(db, shop.id, cy, new Date("2020-06-01T10:00:00Z"), {
      supersededAt: new Date("2020-06-02T10:00:00Z"),
    });

    const { waivers, departures } = await readOwnerStats(db, shop.id, {
      now: NOW,
      timeZone: TZ,
    });
    expect(waivers).toEqual({ seats: 3, signedByDeparture: 2 });
    // The empty departure has nobody to be ready, so it is not counted.
    expect(departures).toEqual({ counted: 2, ready: 1 });
  });

  it("reads the shop's own day when it says a waiver came in before the day", async () => {
    const { db, shop } = ctx;
    const ana = await person(db, shop.id, "Ana");
    // 07:00 UTC on the 11th is 21:00 on the 10th in Honolulu (UTC-10).
    const t = await trip(db, shop.id, "2020-06-11T07:00:00Z");
    await seat(db, shop.id, t.id, ana);
    // Signed at 11:00 UTC on the 10th: 01:00 on the 10th in Honolulu, the day of the trip there and
    // the day before it in UTC.
    await waiver(db, shop.id, ana, new Date("2020-06-10T11:00:00Z"));
    const honolulu = await readOwnerStats(db, shop.id, {
      now: NOW,
      timeZone: "Pacific/Honolulu",
    });
    expect(honolulu.departures).toEqual({ counted: 1, ready: 0 });
    const utc = await readOwnerStats(db, shop.id, { now: NOW, timeZone: "UTC" });
    expect(utc.departures).toEqual({ counted: 1, ready: 1 });
  });

  it("reports how long staff took to clear medical reviews, and how many still wait", async () => {
    const { db, shop } = ctx;
    const [ana, ben, cy, dee] = await Promise.all(
      ["Ana", "Ben", "Cy", "Dee"].map((name) => person(db, shop.id, name)),
    );
    if (!ana || !ben || !cy || !dee) throw new Error("people");
    const signed = new Date("2020-07-01T10:00:00Z");
    // Dee stands in for the staffer who cleared them; the constraint wants a name on the clearing.
    const cleared = (hours: number) => ({
      medicalReviewRequired: true,
      medicalClearedAt: new Date(signed.getTime() + hours * HOUR),
      medicalClearedByPersonId: dee,
      medicalClearanceEvaluatedOn: "2020-06-30",
      medicalClearancePhysicianName: "Dr. Reyes",
    });
    await waiver(db, shop.id, ana, signed, cleared(2));
    await waiver(db, shop.id, ben, signed, cleared(30));
    await waiver(db, shop.id, cy, signed, { medicalReviewRequired: true });
    // No review needed, so no clock.
    await waiver(db, shop.id, dee, signed);

    const { medical } = await readOwnerStats(db, shop.id, { now: NOW, timeZone: TZ });
    expect(medical).toEqual({ cleared: 2, medianHours: 16, waiting: 1 });
  });

  it("follows each course from the ask to the card its departure issued", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .insert(courses)
      .values({ shopId: shop.id, title: "Open Water", slug: "ow-owner-stats" })
      .returning();
    if (!course) throw new Error("course");
    const [ana, ben] = await Promise.all(["Ana", "Ben"].map((name) => person(db, shop.id, name)));
    if (!ana || !ben) throw new Error("people");
    const t = await trip(db, shop.id, "2020-08-01T09:00:00Z", { courseId: course.id });
    await seat(db, shop.id, t.id, ana);
    await seat(db, shop.id, t.id, ben);
    await db.insert(interests).values([
      {
        shopId: shop.id,
        scope: "date",
        askedBy: "diver",
        courseId: course.id,
        name: "Zed",
        email: "zed@example.com",
        partySize: null,
        askedAt: new Date("2020-07-20T09:00:00Z"),
      },
    ] as (typeof interests.$inferInsert)[]);
    await db.insert(cards).values({
      kind: "level",
      shopId: shop.id,
      personId: ana,
      agency: "padi",
      level: "open_water",
      identifier: "PADI-1",
      status: "verified",
      issuedByShopAt: new Date("2020-08-03T09:00:00Z"),
      issuedFromTripId: t.id,
    });

    const { courses: funnel } = await readOwnerStats(db, shop.id, { now: NOW, timeZone: TZ });
    expect(funnel).toEqual([
      { courseId: course.id, title: "Open Water", asked: 1, booked: 2, certified: 1 },
    ]);
  });
});
