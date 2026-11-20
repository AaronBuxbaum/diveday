import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { trips } from "./schema";
import { createTrip, pagedUpcomingTripsWithCounts } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

/** One PGlite for the file, a rolled-back transaction per test (issue #1244). */
const ctx = fileScopedShopContext();

type Page = Awaited<ReturnType<typeof pagedUpcomingTripsWithCounts>>;

/**
 * **Back is the same keyset read in reverse** (issue #3359). The public
 * schedule used to carry every earlier cursor in a `back` URL parameter;
 * `before` replaces that history with one stateless cursor over the same
 * (start, title, id) key. The cases below hold it to the forward walk: from
 * each page's opening cursor, the page before it is the page the walk showed
 * before it, including across four boats leaving in the same minute.
 */
describe("paged schedule, reading backward", () => {
  it("returns, from each page's opening cursor, the page the forward walk showed before it", async () => {
    const { db, shop } = ctx;
    const startsAt = new Date(nowDate().getTime() + 400 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1000);
    const created: string[] = [];
    for (let n = 0; n < 4; n++) {
      const trip = await createTrip(db, {
        shopId: shop.id,
        title: `Same minute ${n}`,
        startsAt,
        endsAt,
        capacity: 10,
        plannedDives: 2,
      });
      if (!trip) throw new Error("failed to create same-minute fixture");
      created.push(trip.id);
    }
    // Titles dealt against id order, so the title key decides the tie.
    const titles = ["Delta drift", "Charlie wall", "Bravo reef", "Alpha wreck"];
    for (const [index, id] of [...created].sort().entries()) {
      await db.update(trips).set({ title: titles[index] }).where(eq(trips.id, id));
    }

    for (let limit = 1; limit <= 5; limit++) {
      const pages: Page[] = [];
      let cursor: string | undefined;
      for (let hops = 0; hops < 200; hops++) {
        const page = await pagedUpcomingTripsWithCounts(db, shop.id, { cursor, limit });
        pages.push(page);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(pages[0]?.prevCursor).toBeNull();
      for (let index = 1; index < pages.length; index++) {
        const opening = pages[index]?.prevCursor;
        expect(opening).not.toBeNull();
        const back = await pagedUpcomingTripsWithCounts(db, shop.id, {
          before: opening ?? undefined,
          limit,
        });
        expect(back.trips.map((t) => t.id)).toEqual(pages[index - 1]?.trips.map((t) => t.id));
        // Going back always leaves a way forward, and a way further back only while rows remain.
        expect(back.nextCursor).not.toBeNull();
        expect(back.prevCursor === null).toBe(index - 1 === 0);
      }
    }
  });

  it("treats a hand-crafted before cursor as page one, like an after cursor", async () => {
    const { db, shop } = ctx;
    const forged = Buffer.from(
      JSON.stringify(["2026-07-24T00:00:00.000Z", "Wreck Trek", "nope"]),
      "utf8",
    ).toString("base64url");
    const forgedPage = await pagedUpcomingTripsWithCounts(db, shop.id, { before: forged });
    const firstPage = await pagedUpcomingTripsWithCounts(db, shop.id);
    expect(forgedPage.trips.map((t) => t.id)).toEqual(firstPage.trips.map((t) => t.id));
    expect(forgedPage.prevCursor).toBeNull();
  });
});

/**
 * **The page is chosen before seats are counted** (issue #4394). With no seat
 * filter the read picks the page's ids first and counts those rows only; with
 * `hasSpace` the count decides which rows qualify, so it counts first. Each read must walk the
 * unbounded fixture read's rows in its order, with its counts.
 */
describe("paged schedule, counting only the page", () => {
  it("walks the same pages with and without a seat filter, with the fixture read's counts", async () => {
    const { db, shop } = ctx;
    const startsAt = new Date(nowDate().getTime() + 500 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1000);
    for (let n = 0; n < 5; n++) {
      await createTrip(db, {
        shopId: shop.id,
        title: `Counted ${n}`,
        startsAt,
        endsAt,
        capacity: 10,
        plannedDives: 2,
      });
    }
    const everything = (await upcomingTripsWithCounts(db, shop.id)).filter((t) => !t.isPrivate);

    for (const limit of [1, 3, 7, 50]) {
      const walks = await Promise.all(
        [undefined, true].map(async (hasSpace) => {
          // Public reads count the page only; `hasSpace` counts first.
          const rows: Page["trips"] = [];
          let cursor: string | undefined;
          for (let hops = 0; hops < 200; hops++) {
            const page = await pagedUpcomingTripsWithCounts(db, shop.id, {
              cursor,
              limit,
              hasSpace,
              publicOnly: true,
            });
            rows.push(...page.trips);
            if (!page.nextCursor) break;
            cursor = page.nextCursor;
          }
          return rows;
        }),
      );
      const withRoom = everything.filter((t) => t.booked < t.sellableCapacity);
      for (const [index, rows] of walks.entries()) {
        const expected = index === 0 ? everything : withRoom;
        expect(rows.map((t) => t.id)).toEqual(expected.map((t) => t.id));
        expect(rows.map((t) => [t.booked, t.bookedDivers])).toEqual(
          expected.map((t) => [t.booked, t.bookedDivers]),
        );
      }
    }
  });

  it("returns an empty page, with no cursors, when nothing is upcoming", async () => {
    const { db, shop } = ctx;
    const far = new Date(nowDate().getTime() + 5000 * 24 * 60 * 60 * 1000);
    const page = await pagedUpcomingTripsWithCounts(db, shop.id, { from: far });
    expect(page).toEqual({ trips: [], nextCursor: null, prevCursor: null });
  });
});
