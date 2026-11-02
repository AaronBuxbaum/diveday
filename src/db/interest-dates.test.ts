import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { getCourseBySlug } from "./courses";
import { createDiver } from "./divers";
import {
  DATE_REQUESTS_PAGE_SIZE,
  listClosedDateInterests,
  listDateInterestsInReach,
  listDeparturesOnDates,
  listOpenDateInterests,
  listOpenDateInterestsForDates,
} from "./interest-dates";
import { addInterest, interestRow, ownerId } from "./interest-dates-fixtures";
import { askForDate, attachDateInterestsToDeparture, setDateInterestOutcome } from "./interests";
import { interests, people, shops, trips } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

async function dateContext() {
  const { db, shop } = ctx;
  const course = await getCourseBySlug(db, shop.id, "open-water-diver");
  if (!course) throw new Error("demo Open Water Diver course missing");
  return { db, shop, course };
}

/** A shop with no date interests seeded, so ordering is only ours. */
async function emptyDateShop() {
  const { db, shop, course } = await dateContext();
  await db.delete(interests).where(and(eq(interests.shopId, shop.id), eq(interests.scope, "date")));
  return { db, shop, course };
}

describe("askForDate", () => {
  it("records every optional field a diver filled in, as a person-less date interest", async () => {
    const { db, shop, course } = await dateContext();
    const record = await askForDate(db, {
      shopId: shop.id,
      courseId: course.id,
      name: "  Priya Sharma  ",
      email: "  Priya@Example.com ",
      phone: " +1 305 555 0134 ",
      experienceLevel: "tried",
      timing: " The week of 12 August ",
      partySize: 2,
      message: " Excited to start! ",
    });

    expect(await interestRow(db, record.id)).toMatchObject({
      scope: "date",
      askedBy: "diver",
      courseId: course.id,
      tripId: null,
      name: "Priya Sharma",
      email: "priya@example.com",
      phone: "+1 305 555 0134",
      experienceLevel: "tried",
      timing: "The week of 12 August",
      partySize: 2,
      message: "Excited to start!",
      createdByPersonId: null,
      closedAt: null,
    });
  });

  it("never creates a person for a stranger's form (H-20260724-one-person-per-email)", async () => {
    const { db, shop, course } = await dateContext();
    const before = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id));
    const record = await askForDate(db, {
      shopId: shop.id,
      courseId: course.id,
      name: "Nobody Here",
      email: "nobody-here@example.com",
    });
    const after = await db.select({ id: people.id }).from(people).where(eq(people.shopId, shop.id));
    expect(after).toHaveLength(before.length);
    expect((await interestRow(db, record.id)).personId).toBeNull();
  });

  it("records a minimal submission, and normalizes whitespace-only fields to null", async () => {
    const { db, shop, course } = await dateContext();
    const record = await askForDate(db, {
      shopId: shop.id,
      courseId: course.id,
      name: "   ",
      experienceLevel: "never",
    });
    expect(await interestRow(db, record.id)).toMatchObject({
      name: null,
      email: null,
      phone: null,
      timing: null,
      partySize: null,
      message: null,
      preferredDate: null,
      alternateDate: null,
      dateFlexible: false,
      experienceLevel: "never",
    });
  });

  it("clamps a party into the column's range rather than refusing the form", async () => {
    const { db, shop, course } = await dateContext();
    const record = await askForDate(db, { shopId: shop.id, courseId: course.id, partySize: 99 });
    expect((await interestRow(db, record.id)).partySize).toBe(20);
  });

  it("rejects a course id that does not exist (FK constraint, not a silent orphan row)", async () => {
    const { db, shop } = await dateContext();
    await expect(
      askForDate(db, { shopId: shop.id, courseId: crypto.randomUUID(), experienceLevel: "lapsed" }),
    ).rejects.toThrow();
  });

  it("rejects an experience level outside the four codes the column allows", async () => {
    const { db, shop, course } = await dateContext();
    await expect(
      askForDate(db, {
        shopId: shop.id,
        courseId: course.id,
        experienceLevel: "curious" as CourseInquiryExperience,
      }),
    ).rejects.toThrow();
  });

  it("records the staffer who took a call", async () => {
    const { db, shop } = await dateContext();
    const staffer = await ownerId(db, shop.id);
    const record = await askForDate(db, {
      shopId: shop.id,
      interest: "A night dive",
      phone: "+1 305 555 0100",
      createdByPersonId: staffer,
    });
    expect(await interestRow(db, record.id)).toMatchObject({
      askedBy: "diver",
      createdByPersonId: staffer,
    });
  });

  /**
   * The `person_id` snapshot exists for erasure: once a diver changes their
   * email, the address on this row is the sweep's only other handle and it no
   * longer matches (ADR 20260802-diver-data-erasure). Every assertion here is
   * about *not* over-linking: a wrong link erases a bystander's interest.
   */
  describe("the person link", () => {
    it("links an interest to the live diver holding that exact address, case-insensitively", async () => {
      const { db, shop, course } = await dateContext();
      const diver = await createDiver(db, {
        shopId: shop.id,
        fullName: "Linked Lina",
        email: "lina@example.com",
      });
      if (!diver) throw new Error("diver insert failed");
      const record = await askForDate(db, {
        shopId: shop.id,
        courseId: course.id,
        email: "  LINA@Example.com ",
      });
      expect((await interestRow(db, record.id)).personId).toBe(diver.id);
    });

    it("leaves the link null when the address belongs to nobody here", async () => {
      const { db, shop, course } = await dateContext();
      const record = await askForDate(db, {
        shopId: shop.id,
        courseId: course.id,
        email: "stranger@example.com",
      });
      expect((await interestRow(db, record.id)).personId).toBeNull();
    });

    it("never links on a phone number: a household number is shared", async () => {
      const { db, shop, course } = await dateContext();
      await createDiver(db, { shopId: shop.id, fullName: "Phone Pat", phone: "+1 305 555 0134" });
      const record = await askForDate(db, {
        shopId: shop.id,
        courseId: course.id,
        phone: "+1 305 555 0134",
      });
      expect((await interestRow(db, record.id)).personId).toBeNull();
    });

    it("never links to a removed diver, even when their address still matches", async () => {
      const { db, shop, course } = await dateContext();
      const diver = await createDiver(db, {
        shopId: shop.id,
        fullName: "Removed Rhea",
        email: "rhea@example.com",
      });
      if (!diver) throw new Error("diver insert failed");
      await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, diver.id));
      const record = await askForDate(db, {
        shopId: shop.id,
        courseId: course.id,
        email: "rhea@example.com",
      });
      expect((await interestRow(db, record.id)).personId).toBeNull();
    });

    it("never links across shops", async () => {
      const { db, shop, course } = await dateContext();
      const [rival] = await db
        .insert(shops)
        .values({ name: "Rival Reef", slug: "rival-reef-date-capture", timezone: "UTC" })
        .returning();
      if (!rival) throw new Error("rival shop insert failed");
      await createDiver(db, { shopId: rival.id, fullName: "Rival Rae", email: "rae@example.com" });
      const record = await askForDate(db, {
        shopId: shop.id,
        courseId: course.id,
        email: "rae@example.com",
      });
      expect((await interestRow(db, record.id)).personId).toBeNull();
    });
  });

  /** One rule keeps "no course" from meaning "about nothing". */
  describe("a dive request, with dates", () => {
    it("records a request that names an interest instead of a course", async () => {
      const { db, shop } = await dateContext();
      const record = await askForDate(db, {
        shopId: shop.id,
        courseId: null,
        interest: "  A two-tank on the wrecks  ",
        email: "tomas@example.com",
        preferredDate: "2026-09-12",
        alternateDate: "2026-09-19",
        dateFlexible: true,
      });
      expect(await interestRow(db, record.id)).toMatchObject({
        courseId: null,
        interest: "A two-tank on the wrecks",
        preferredDate: "2026-09-12",
        alternateDate: "2026-09-19",
        dateFlexible: true,
      });
    });

    it("refuses a request that is about nothing, or about only whitespace", async () => {
      const { db, shop } = await dateContext();
      await expect(
        askForDate(db, { shopId: shop.id, courseId: null, email: "nobody@example.com" }),
      ).rejects.toThrow();
      await expect(
        askForDate(db, { shopId: shop.id, courseId: null, interest: "   " }),
      ).rejects.toThrow();
    });

    it("refuses an about-nothing row written straight at the table (the check constraint)", async () => {
      const { db, shop } = await dateContext();
      await expect(
        db.insert(interests).values({ shopId: shop.id, scope: "date", askedBy: "diver" }),
      ).rejects.toThrow();
    });
  });
});

describe("listOpenDateInterests", () => {
  it("reads the soonest date first and leaves the dateless ones at the end", async () => {
    const { db, shop } = await emptyDateShop();
    await addInterest(db, shop.id, { interest: "later", preferredDate: "2026-10-01" });
    await addInterest(db, shop.id, { interest: "no date" });
    await addInterest(db, shop.id, { interest: "sooner", preferredDate: "2026-09-12" });
    // Its alternate is the earliest date it can be served on, so it sorts by
    // that rather than by the later day it named first.
    await addInterest(db, shop.id, {
      interest: "early alternate",
      preferredDate: "2026-10-05",
      alternateDate: "2026-09-05",
    });

    const page = await listOpenDateInterests(db, shop.id);
    expect(page.rows.map((row) => row.interest)).toEqual([
      "early alternate",
      "sooner",
      "later",
      "no date",
    ]);
    expect(page.total).toBe(4);
    expect(page.page).toBe(1);
  });

  it("carries the course title for an interest that names one, and null for one that doesn't", async () => {
    const { db, shop, course } = await emptyDateShop();
    await askForDate(db, { shopId: shop.id, courseId: course.id, preferredDate: "2026-09-12" });
    await addInterest(db, shop.id, { interest: "a night dive", preferredDate: "2026-09-13" });

    const page = await listOpenDateInterests(db, shop.id);
    expect(page.rows.map((row) => [row.courseTitle, row.interest])).toEqual([
      [course.title, null],
      [null, "a night dive"],
    ]);
  });

  it("never reads another shop's interests, nor an interest of another scope", async () => {
    const { db, shop } = await emptyDateShop();
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-date-interests", timezone: "UTC" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    await addInterest(db, rival.id, { interest: "theirs", preferredDate: "2026-09-12" });
    await addInterest(db, shop.id, { interest: "ours", preferredDate: "2026-09-12" });

    const page = await listOpenDateInterests(db, shop.id);
    expect(page.rows.map((row) => row.interest)).toEqual(["ours"]);
    expect(page.total).toBe(1);
  });

  it("pages, and its count is the whole shop rather than the page", async () => {
    const { db, shop } = await emptyDateShop();
    for (let i = 0; i < DATE_REQUESTS_PAGE_SIZE + 3; i += 1) {
      await addInterest(db, shop.id, {
        interest: `request ${i}`,
        preferredDate: `2026-09-${String(i + 1).padStart(2, "0")}`,
      });
    }
    const first = await listOpenDateInterests(db, shop.id);
    expect(first.rows).toHaveLength(DATE_REQUESTS_PAGE_SIZE);
    expect(first.total).toBe(DATE_REQUESTS_PAGE_SIZE + 3);
    expect(first.pageCount).toBe(2);
    expect((await listOpenDateInterests(db, shop.id, { page: 2 })).rows).toHaveLength(3);
    // A bookmarked page past the end lands on the last real one.
    const past = await listOpenDateInterests(db, shop.id, { page: 9 });
    expect(past.page).toBe(2);
    expect(past.rows).toHaveLength(3);
  });

  /**
   * **A request finds its diver whenever they joined** (the Tomás Ferreira row
   * in the demo shop). The link written at capture time can only see the roster
   * as it was then, so the reader resolves the rest by address.
   */
  describe("the diver behind an unlinked interest", () => {
    it("links an interest to a diver added after it, by address, ignoring case", async () => {
      const { db, shop } = await emptyDateShop();
      const id = await addInterest(db, shop.id, {
        interest: "a wreck dive",
        preferredDate: "2026-09-12",
        email: "Later.Lou@example.com",
      });
      const diver = await createDiver(db, {
        shopId: shop.id,
        fullName: "Later Lou",
        email: "later.lou@example.com",
      });
      if (!diver) throw new Error("diver insert failed");

      expect((await listOpenDateInterests(db, shop.id)).rows[0]?.personId).toBe(diver.id);
      // Read-time only: the stored column is what capture wrote.
      expect((await interestRow(db, id)).personId).toBeNull();
    });

    it("never links by phone, since a household number is shared", async () => {
      const { db, shop } = await emptyDateShop();
      await addInterest(db, shop.id, { interest: "a wreck dive", phone: "+1 305 555 0177" });
      await createDiver(db, { shopId: shop.id, fullName: "Phone Pat", phone: "+1 305 555 0177" });
      expect((await listOpenDateInterests(db, shop.id)).rows[0]?.personId).toBeNull();
    });

    it("never links to a removed diver, or to another shop's", async () => {
      const { db, shop } = await emptyDateShop();
      await addInterest(db, shop.id, { interest: "a wreck dive", email: "gone@example.com" });
      const removed = await createDiver(db, {
        shopId: shop.id,
        fullName: "Gone Gil",
        email: "gone@example.com",
      });
      if (!removed) throw new Error("diver insert failed");
      await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, removed.id));
      const [rival] = await db
        .insert(shops)
        .values({ name: "Rival Reef", slug: "rival-reef-interest-links", timezone: "UTC" })
        .returning();
      if (!rival) throw new Error("rival shop insert failed");
      await createDiver(db, { shopId: rival.id, fullName: "Rival Gil", email: "gone@example.com" });
      expect((await listOpenDateInterests(db, shop.id)).rows[0]?.personId).toBeNull();
    });
  });
});

/**
 * **A date interest closes** (third UX review, item 13): booked from, or marked
 * done, it leaves the open list and the day lookups and sits under Done until
 * someone reopens it.
 */
describe("setDateInterestOutcome", () => {
  async function openInterest() {
    const { db, shop, course } = await dateContext();
    const record = await askForDate(db, {
      shopId: shop.id,
      courseId: course.id,
      name: "Closing Test",
      email: "closing@example.com",
      preferredDate: "2031-05-03",
    });
    return { db, shop, id: record.id };
  }
  const openIds = async (db: AppDb, shopId: string) =>
    (await listOpenDateInterests(db, shopId, { page: 1 })).rows.map((row) => row.id);

  it("moves a done interest off the open list and the day lookup, onto Done", async () => {
    const { db, shop, id } = await openInterest();
    expect(await openIds(db, shop.id)).toContain(id);
    expect(
      await setDateInterestOutcome(db, {
        shopId: shop.id,
        interestId: id,
        outcome: "done",
        now: nowDate(),
      }),
    ).toBe(true);
    expect(await openIds(db, shop.id)).not.toContain(id);
    expect(
      (await listOpenDateInterestsForDates(db, shop.id, ["2031-05-03"])).map((r) => r.id),
    ).not.toContain(id);
    const [done] = await listClosedDateInterests(db, shop.id);
    expect(done).toMatchObject({ id, closedAs: "done" });
  });

  it("keeps the first answer: a later booking does not restamp a closed interest", async () => {
    const { db, shop, id } = await openInterest();
    const first = new Date("2031-04-01T12:00:00Z");
    await setDateInterestOutcome(db, {
      shopId: shop.id,
      interestId: id,
      outcome: "done",
      now: first,
    });
    expect(
      await setDateInterestOutcome(db, {
        shopId: shop.id,
        interestId: id,
        outcome: "booked",
        now: nowDate(),
      }),
    ).toBe(false);
    expect(await interestRow(db, id)).toMatchObject({ closedAs: "done", closedAt: first });
  });

  it("reopens an interest", async () => {
    const { db, shop, id } = await openInterest();
    const now = nowDate();
    await setDateInterestOutcome(db, { shopId: shop.id, interestId: id, outcome: "booked", now });
    await setDateInterestOutcome(db, { shopId: shop.id, interestId: id, outcome: null, now });
    expect(await openIds(db, shop.id)).toContain(id);
    expect(await interestRow(db, id)).toMatchObject({ closedAt: null, closedAs: null });
  });

  it("never touches another shop's interest, nor an interest of another scope", async () => {
    const { db, shop, id } = await openInterest();
    expect(
      await setDateInterestOutcome(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        interestId: id,
        outcome: "done",
        now: nowDate(),
      }),
    ).toBe(false);
    const [anytime] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "anytime",
        askedBy: "diver",
        personId: await ownerId(db, shop.id),
      })
      .returning({ id: interests.id });
    if (!anytime) throw new Error("anytime interest insert failed");
    expect(
      await setDateInterestOutcome(db, {
        shopId: shop.id,
        interestId: anytime.id,
        outcome: "done",
        now: nowDate(),
      }),
    ).toBe(false);
  });

  it("refuses a stamp without its kind at the database", async () => {
    const { db, id } = await openInterest();
    await expect(
      db.update(interests).set({ closedAt: nowDate() }).where(eq(interests.id, id)),
    ).rejects.toThrow();
  });

  it("does not close the departure rows copied from it: a diver offered Saturday keeps the offer", async () => {
    const { db, shop } = await dateContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seed trip missing");
    const id = await addInterest(db, shop.id, {
      interest: "night dive",
      preferredDate: "2031-05-03",
      email: "keep@example.com",
    });
    await attachDateInterestsToDeparture(db, {
      shopId: shop.id,
      tripId: trip.id,
      interestIds: [id],
      createdByPersonId: await ownerId(db, shop.id),
    });
    await setDateInterestOutcome(db, {
      shopId: shop.id,
      interestId: id,
      outcome: "done",
      now: nowDate(),
    });
    const [child] = await db.select().from(interests).where(eq(interests.parentInterestId, id));
    expect(child).toMatchObject({ scope: "departure", closedAt: null, closedAs: null });
  });
});

describe("attachDateInterestsToDeparture", () => {
  async function attachContext() {
    const { db, shop } = await dateContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seed trip missing");
    return { db, shop, trip, author: await ownerId(db, shop.id) };
  }

  it("writes a departure child per interest: asked by the diver, not offered, carrying the snapshot", async () => {
    const { db, shop, trip, author } = await attachContext();
    const id = await addInterest(db, shop.id, {
      interest: "wrecks",
      preferredDate: "2031-05-03",
      name: "Stranger Sam",
      email: "sam@example.com",
      phone: "+1 305 555 0111",
    });
    await db.update(interests).set({ partySize: 3 }).where(eq(interests.id, id));

    expect(
      await attachDateInterestsToDeparture(db, {
        shopId: shop.id,
        tripId: trip.id,
        interestIds: [id, id],
        createdByPersonId: author,
      }),
    ).toBe(1);
    const parent = await interestRow(db, id);
    const [child] = await db.select().from(interests).where(eq(interests.parentInterestId, id));
    expect(child).toMatchObject({
      scope: "departure",
      askedBy: "diver",
      tripId: trip.id,
      personId: null,
      name: "Stranger Sam",
      email: "sam@example.com",
      phone: "+1 305 555 0111",
      partySize: 3,
      offeredAt: null,
      emailedAt: null,
      createdByPersonId: author,
    });
    expect(child?.askedAt).toEqual(parent.askedAt);
  });

  it("is harmless to repeat, and a diver already on the list keeps the row they have", async () => {
    const { db, shop, trip, author } = await attachContext();
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Waiting Wren",
      email: "wren@example.com",
    });
    if (!diver) throw new Error("diver insert failed");
    const [own] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: diver.id,
        partySize: 1,
      })
      .returning({ id: interests.id });
    const linked = (
      await askForDate(db, { shopId: shop.id, interest: "reef", email: "wren@example.com" })
    ).id;
    const input = {
      shopId: shop.id,
      tripId: trip.id,
      interestIds: [linked],
      createdByPersonId: author,
    };
    expect(await attachDateInterestsToDeparture(db, input)).toBe(1);
    expect(await attachDateInterestsToDeparture(db, input)).toBe(0);
    // Her own wait-list row is untouched and still the only row that is hers.
    const rows = await db
      .select()
      .from(interests)
      .where(and(eq(interests.tripId, trip.id), eq(interests.personId, diver.id)));
    expect(rows.map((row) => row.id)).toEqual([own?.id]);
    expect(rows[0]?.parentInterestId).toBeNull();
  });

  // Security review of #2656, MAJOR 2 (H-20260724-one-person-per-email): the email link on a date interest is a
  // snapshot for erasure, set from an unauthenticated form on the address
  // alone. It must never make the request's departure row that person's.
  it("keeps the child person-less on the request's own snapshot, even when the address matched a diver", async () => {
    const { db, shop, trip, author } = await attachContext();
    const ana = await createDiver(db, {
      shopId: shop.id,
      fullName: "Ana Real",
      email: "ana-real@example.com",
    });
    if (!ana) throw new Error("diver insert failed");
    // "Bob" types Ana's address on the public form.
    const borrowed = (
      await askForDate(db, {
        shopId: shop.id,
        interest: "wrecks",
        name: "Bob Borrower",
        email: "ANA-REAL@example.com",
        phone: "+1 305 555 0199",
      })
    ).id;
    expect((await interestRow(db, borrowed)).personId).toBe(ana.id);

    expect(
      await attachDateInterestsToDeparture(db, {
        shopId: shop.id,
        tripId: trip.id,
        interestIds: [borrowed],
        createdByPersonId: author,
      }),
    ).toBe(1);
    const [child] = await db
      .select()
      .from(interests)
      .where(eq(interests.parentInterestId, borrowed));
    expect(child).toMatchObject({
      personId: null,
      name: "Bob Borrower",
      email: "ana-real@example.com",
      phone: "+1 305 555 0199",
    });
    // Ana is on nobody's list for this departure.
    expect(
      await db
        .select()
        .from(interests)
        .where(and(eq(interests.tripId, trip.id), eq(interests.personId, ana.id))),
    ).toEqual([]);
  });

  it("reaches nothing outside this shop, and writes nothing for a rehearsal or a stranger author", async () => {
    const { db, shop, trip, author } = await attachContext();
    const id = await addInterest(db, shop.id, { interest: "wrecks", email: "x@example.com" });
    expect(
      await attachDateInterestsToDeparture(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        tripId: trip.id,
        interestIds: [id],
        createdByPersonId: author,
      }),
    ).toBe(0);
    expect(
      await attachDateInterestsToDeparture(db, {
        shopId: shop.id,
        tripId: trip.id,
        interestIds: [id],
        createdByPersonId: crypto.randomUUID(),
      }),
    ).toBe(0);
    await db.update(trips).set({ isPrivate: true, isRehearsal: true }).where(eq(trips.id, trip.id));
    expect(
      await attachDateInterestsToDeparture(db, {
        shopId: shop.id,
        tripId: trip.id,
        interestIds: [id],
        createdByPersonId: author,
      }),
    ).toBe(0);
    expect(
      await db.select().from(interests).where(eq(interests.parentInterestId, id)),
    ).toHaveLength(0);
  });
});

describe("listDateInterestsInReach", () => {
  async function reachContext() {
    const { db, shop } = await emptyDateShop();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seed trip missing");
    const day = calendarDateInTimezone(trip.startsAt, shop.timezone);
    return { db, shop, trip, day };
  }

  it("includes its own day, a fallback day and a flexible neighbour, in the order people asked", async () => {
    const { db, shop, trip, day } = await reachContext();
    const flexible = await addInterest(db, shop.id, {
      interest: "flexible",
      preferredDate: shiftCalendarDate(day, 3),
      dateFlexible: true,
      askedAt: new Date("2031-01-01T00:00:00Z"),
    });
    const alternate = await addInterest(db, shop.id, {
      interest: "alternate",
      preferredDate: shiftCalendarDate(day, 20),
      alternateDate: day,
      askedAt: new Date("2031-01-02T00:00:00Z"),
    });
    const preferred = await addInterest(db, shop.id, {
      interest: "preferred",
      preferredDate: day,
      askedAt: new Date("2031-01-03T00:00:00Z"),
    });

    const reach = await listDateInterestsInReach(db, shop.id, { tripId: trip.id });
    expect(reach.map((row) => [row.id, row.match])).toEqual([
      [flexible, "nearby"],
      [alternate, "alternate"],
      [preferred, "preferred"],
    ]);
    // The same answer by date, which is how the panel asks before a trip exists.
    expect(
      (await listDateInterestsInReach(db, shop.id, { date: day })).map((row) => row.id),
    ).toEqual(reach.map((row) => row.id));
  });

  it("leaves out a near day that is not flexible, a day past three, a closed interest and another shop's", async () => {
    const { db, shop, trip, day } = await reachContext();
    await addInterest(db, shop.id, {
      interest: "near but fixed",
      preferredDate: shiftCalendarDate(day, 1),
    });
    await addInterest(db, shop.id, {
      interest: "too far",
      preferredDate: shiftCalendarDate(day, 4),
      dateFlexible: true,
    });
    const closed = await addInterest(db, shop.id, { interest: "closed", preferredDate: day });
    await setDateInterestOutcome(db, {
      shopId: shop.id,
      interestId: closed,
      outcome: "done",
      now: nowDate(),
    });
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-reach", timezone: "UTC" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    await addInterest(db, rival.id, { interest: "theirs", preferredDate: day });

    expect(await listDateInterestsInReach(db, shop.id, { tripId: trip.id })).toEqual([]);
    expect(await listDateInterestsInReach(db, rival.id, { tripId: trip.id })).toEqual([]);
  });

  it("reads 'offered' off the departure row the interest already has on this trip", async () => {
    const { db, shop, trip, day } = await reachContext();
    const id = await addInterest(db, shop.id, {
      interest: "wrecks",
      preferredDate: day,
      email: "a@example.com",
    });
    const [before] = await listDateInterestsInReach(db, shop.id, { tripId: trip.id });
    expect(before).toMatchObject({ id, departureInterestId: null, offeredAt: null });

    await attachDateInterestsToDeparture(db, {
      shopId: shop.id,
      tripId: trip.id,
      interestIds: [id],
      createdByPersonId: await ownerId(db, shop.id),
    });
    const offeredAt = new Date("2031-01-01T00:00:00Z");
    await db.update(interests).set({ offeredAt }).where(eq(interests.parentInterestId, id));
    const [after] = await listDateInterestsInReach(db, shop.id, { tripId: trip.id });
    expect(after?.departureInterestId).toBeTruthy();
    expect(after?.offeredAt).toEqual(offeredAt);
    // Another departure's panel does not see this offer.
    const [other] = await listDateInterestsInReach(db, shop.id, { date: day });
    expect(other?.departureInterestId).toBeNull();
  });

  it("is empty for a trip that is not this shop's", async () => {
    const { db, shop } = await reachContext();
    expect(await listDateInterestsInReach(db, shop.id, { tripId: crypto.randomUUID() })).toEqual(
      [],
    );
  });
});

describe("listDeparturesOnDates", () => {
  it("names the public departures on a day, with the seats a diver could still book", async () => {
    const { db, shop } = await dateContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seed trip missing");
    const day = calendarDateInTimezone(trip.startsAt, shop.timezone);
    const found = await listDeparturesOnDates(db, shop.id, [day], shop.timezone);
    const mine = found.find((row) => row.tripId === trip.id);
    expect(mine).toMatchObject({ title: trip.title, date: day });
    expect(mine?.seatsLeft).toBe(Math.max(0, trip.sellableCapacity - trip.booked));
    expect(found.every((row) => row.date === day)).toBe(true);
  });

  it("omits a rehearsal, a cancelled departure and a day nobody asked about", async () => {
    const { db, shop } = await dateContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seed trip missing");
    const day = calendarDateInTimezone(trip.startsAt, shop.timezone);
    await db.update(trips).set({ isPrivate: true, isRehearsal: true }).where(eq(trips.id, trip.id));
    expect(
      (await listDeparturesOnDates(db, shop.id, [day], shop.timezone)).map((r) => r.tripId),
    ).not.toContain(trip.id);
    await db
      .update(trips)
      .set({ isPrivate: false, isRehearsal: false, status: "cancelled" })
      .where(eq(trips.id, trip.id));
    expect(
      (await listDeparturesOnDates(db, shop.id, [day], shop.timezone)).map((r) => r.tripId),
    ).not.toContain(trip.id);
    expect(await listDeparturesOnDates(db, shop.id, [], shop.timezone)).toEqual([]);
  });
});
