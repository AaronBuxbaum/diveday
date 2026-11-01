import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { trips } from "./schema";
import { getTodayWork } from "./today";
import { createTrip, moveTrip, setTripStatus } from "./trips";

const ctx = fileScopedShopContext();
const HOUR = 60 * 60 * 1000;

/**
 * **A boat clash on the surface a shop starts its morning on** (H-20260916-may-one-hull-carry, issue
 * #2135). Two live departures on one hull at overlapping hours; Today says it
 * once, as a warning, on the earlier departure, naming the hull and the other
 * departure. Information only: nothing here gates a booking or a move.
 */
describe("boat clashes on Today (H-20260916-may-one-hull-carry, #2135)", () => {
  async function hull(name = "Clash hull") {
    return createBoat(ctx.db, ctx.shop.id, name, 12);
  }

  async function departure(title: string, startsAt: Date, hours: number, boatId: string | null) {
    const trip = await createTrip(ctx.db, {
      shopId: ctx.shop.id,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + hours * HOUR),
      capacity: 6,
      boatId,
    });
    if (!trip) throw new Error(`${title} not created`);
    return trip;
  }

  async function boatClashRows(now: Date) {
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    return work.actions.filter((action) => action.kind === "boat_clash");
  }

  /** A morning charter slid on top of the later reef drift: the H-20260916-may-one-hull-carry scenario. */
  async function oneHullTwice(now: Date, boatId: string) {
    const driftStarts = new Date(now.getTime() + 2 * 24 * HOUR);
    const drift = await departure("Reef drift", driftStarts, 4, boatId);
    const charter = await departure(
      "Morning charter",
      new Date(driftStarts.getTime() - 3 * HOUR),
      1.5,
      boatId,
    );
    expect((await moveTrip(ctx.db, ctx.shop.id, charter.id, driftStarts)).ok).toBe(true);
    return { drift, charter };
  }

  it("raises one warning row for the pair, naming the hull and the other departure", async () => {
    const now = nowDate();
    const { id: boatId } = await hull();
    const { drift, charter } = await oneHullTwice(now, boatId);

    const rows = await boatClashRows(now);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect([drift.id, charter.id]).toContain(row?.departure?.tripId);
    expect(row).toMatchObject({
      kind: "boat_clash",
      aboutDeparture: true,
      href: `/shop/${ctx.shop.slug}/trips/${row?.departure?.tripId}?view=details`,
    });
    expect(row?.detail).toContain("Clash hull");
    const other = row?.departure?.tripId === drift.id ? "Morning charter" : "Reef drift";
    expect(row?.detail).toContain(other);
  });

  // Issue #2788: two departures on one hull at the same minute put the row on
  // whichever trip id sorted first — fresh per seed, so it swapped boats
  // between runs. Titles are chosen against the ids so an id tiebreak fails.
  it("puts a same-minute clash on the departure whose title reads first, whatever the ids", async () => {
    const now = nowDate();
    const { id: boatId } = await hull();
    const { drift, charter } = await oneHullTwice(now, boatId);
    const [lowId, highId] = [drift.id, charter.id].sort((a, b) => a.localeCompare(b));
    if (!lowId || !highId) throw new Error("fixture");
    await ctx.db.update(trips).set({ title: "Two-Tank Reef" }).where(eq(trips.id, lowId));
    await ctx.db.update(trips).set({ title: "Morning Two-Tank" }).where(eq(trips.id, highId));
    const rows = await boatClashRows(now);
    expect(rows.map((row) => row.departure?.tripId)).toEqual([highId]);
    expect(rows[0]?.detail).toContain("Two-Tank Reef");
  });

  it("leaves two departures that tie up nose to tail alone", async () => {
    const now = nowDate();
    const { id: boatId } = await hull();
    const start = new Date(now.getTime() + 2 * 24 * HOUR);
    await departure("Dawn run", new Date(start.getTime() - 2 * HOUR), 2, boatId);
    await departure("Noon run", start, 2, boatId);
    expect(await boatClashRows(now)).toEqual([]);
  });

  it("leaves departures with no boat alone", async () => {
    const now = nowDate();
    const start = new Date(now.getTime() + 2 * 24 * HOUR);
    await departure("Shore A", start, 3, null);
    await departure("Shore B", start, 3, null);
    expect(await boatClashRows(now)).toEqual([]);
  });

  it("leaves two different hulls alone", async () => {
    const now = nowDate();
    const one = await hull("Hull one");
    const two = await hull("Hull two");
    const start = new Date(now.getTime() + 2 * 24 * HOUR);
    await departure("On one", start, 3, one.id);
    await departure("On two", start, 3, two.id);
    expect(await boatClashRows(now)).toEqual([]);
  });

  it("ignores a called-off departure", async () => {
    const now = nowDate();
    const { id: boatId } = await hull();
    const { charter } = await oneHullTwice(now, boatId);
    await setTripStatus(ctx.db, ctx.shop.id, charter.id, "cancelled");
    expect(await boatClashRows(now)).toEqual([]);
  });

  it("goes quiet once both departures are home", async () => {
    const now = nowDate();
    const { id: boatId } = await hull();
    const { drift } = await oneHullTwice(now, boatId);
    const home = new Date(drift.startsAt.getTime() + 6 * HOUR);
    expect(await boatClashRows(home)).toEqual([]);
  });
});
