import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { trips } from "./schema";
import { createTrip, pagedUpcomingTripsWithCounts } from "./trips";

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
