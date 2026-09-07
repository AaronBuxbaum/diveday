import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { seasonEvents, shops } from "./schema";
import {
  createSeasonEvent,
  deleteSeasonEvent,
  getSeasonEvent,
  listSeasonEvents,
  updateSeasonEvent,
} from "./season-events";
import { createTripLens, deleteTripLens } from "./trip-lenses";

const miniSeason = {
  name: "Lobster mini-season",
  note: "Two days, and every reef in the Keys is busy.",
  startsOn: "2026-07-29",
  endsOn: "2026-07-30",
  lensId: null,
};

async function rivalShop(db: AppDb) {
  const [rival] = await db
    .insert(shops)
    .values({ name: "Rival Reef", slug: "rival-reef-seasons", timezone: "America/New_York" })
    .returning();
  if (!rival) throw new Error("rival shop insert failed");
  return rival;
}

function mustCreate<T>(row: T | null): T {
  if (!row) throw new Error("season insert failed");
  return row;
}

describe("the shop's own calendar", () => {
  it("writes a season, reads it back, and orders the list by when it opens", async () => {
    const { db, shop } = await seededShopContext();
    const later = mustCreate(
      await createSeasonEvent(db, shop.id, { ...miniSeason, name: "Lionfish derby" }),
    );
    const earlier = mustCreate(
      await createSeasonEvent(db, shop.id, {
        ...miniSeason,
        name: "Turtle nesting",
        startsOn: "2026-03-01",
        endsOn: "2026-10-31",
      }),
    );

    // The demo shop arrives with its own calendar (`src/db/seed-season-events.ts`),
    // so this asserts the order of the two rows it wrote rather than the whole list.
    const listed = await listSeasonEvents(db, shop.id);
    const written = listed.filter((event) => event.id === earlier.id || event.id === later.id);
    expect(written.map((event) => event.id)).toEqual([earlier.id, later.id]);
    expect(written[1]?.note).toBe(miniSeason.note);
    expect(await getSeasonEvent(db, shop.id, later.id)).not.toBeNull();
  });

  it("carries the shop's own word for the kind of day, and drops it once that word is gone", async () => {
    const { db, shop } = await seededShopContext();
    const lens = mustCreate(await createTripLens(db, shop.id, "Bug hunting"));
    const event = mustCreate(
      await createSeasonEvent(db, shop.id, { ...miniSeason, lensId: lens.id }),
    );

    const [withLens] = (await listSeasonEvents(db, shop.id)).filter((row) => row.id === event.id);
    expect(withLens?.lens).toEqual({ id: lens.id, name: "Bug hunting", slug: "bug-hunting" });

    // A deleted word is stamped, not removed, so the FK still resolves — the
    // join has to narrow to live words itself or the band would link a visitor
    // at a chip the rail has stopped rendering.
    await deleteTripLens(db, shop.id, lens.id);

    const [afterDelete] = (await listSeasonEvents(db, shop.id)).filter(
      (row) => row.id === event.id,
    );
    expect(afterDelete?.lensId).toBe(lens.id);
    expect(afterDelete?.lens).toBeNull();
  });

  it("edits the words and the days in place", async () => {
    const { db, shop } = await seededShopContext();
    const event = mustCreate(await createSeasonEvent(db, shop.id, miniSeason));

    const saved = await updateSeasonEvent(db, shop.id, event.id, {
      ...miniSeason,
      name: "Mini-season",
      note: null,
      endsOn: "2026-07-31",
    });
    expect(saved?.name).toBe("Mini-season");
    expect(saved?.note).toBeNull();
    expect(saved?.endsOn).toBe("2026-07-31");
  });

  it("stamps a delete and stops reading it back", async () => {
    const { db, shop } = await seededShopContext();
    const event = mustCreate(await createSeasonEvent(db, shop.id, miniSeason));

    expect(await deleteSeasonEvent(db, shop.id, event.id)).toBe(true);
    expect(await getSeasonEvent(db, shop.id, event.id)).toBeNull();
    expect((await listSeasonEvents(db, shop.id)).some((row) => row.id === event.id)).toBe(false);

    const [row] = await db.select().from(seasonEvents).where(eq(seasonEvents.id, event.id));
    expect(row?.deletedAt).not.toBeNull();
    // A second delete finds nothing live, so the date keeps saying when the
    // shop actually took the season off its calendar.
    expect(await deleteSeasonEvent(db, shop.id, event.id)).toBe(false);
  });

  it("refuses to read, edit or delete another shop's season", async () => {
    const { db, shop } = await seededShopContext();
    const rival = await rivalShop(db);
    const event = mustCreate(await createSeasonEvent(db, shop.id, miniSeason));

    expect(await getSeasonEvent(db, rival.id, event.id)).toBeNull();
    expect(await updateSeasonEvent(db, rival.id, event.id, miniSeason)).toBeNull();
    expect(await deleteSeasonEvent(db, rival.id, event.id)).toBe(false);
    expect(await getSeasonEvent(db, shop.id, event.id)).not.toBeNull();
  });

  /**
   * The floor under `seasonEventIssues`. The form answers the person; this is
   * what stops a window that ends before it starts ever reaching the table.
   */
  it("refuses a backwards window at the database", async () => {
    const { db, shop } = await seededShopContext();
    await expect(
      createSeasonEvent(db, shop.id, {
        ...miniSeason,
        startsOn: "2026-07-30",
        endsOn: "2026-07-29",
      }),
    ).rejects.toThrow();
  });
});
