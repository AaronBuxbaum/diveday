import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { lastPrintedAt, printRunKey, printRunsByKey, recordPrintRun } from "./print-runs";
import { shops } from "./schema";

/**
 * The register's one stored fact: when each sheet was last printed (ADR
 * 20260908-one-hand, decision 6, lever X).
 */

type Db = Awaited<ReturnType<typeof createTestDb>>;

let db: Db;
let shopId: string;
let otherShopId: string;

async function makeShop(name: string, slug: string): Promise<string> {
  const [row] = await db
    .insert(shops)
    .values({ name, slug, timezone: "America/New_York" })
    .returning({ id: shops.id });
  if (!row) throw new Error("shop insert returned nothing");
  return row.id;
}

beforeEach(async () => {
  db = await createTestDb();
  shopId = await makeShop("Blue Mantis", "blue-mantis-print");
  otherShopId = await makeShop("Coral Key", "coral-key-print");
});

describe("recording a print run", () => {
  it("answers with nothing before anything has been printed", async () => {
    expect(await lastPrintedAt(db, shopId, "dock_sign")).toBeNull();
    expect(await printRunsByKey(db, shopId)).toEqual(new Map());
  });

  it("keeps one row per sheet, carrying the later date", async () => {
    // Printing the dock sign twice is one row, not a trail: the register asks
    // "when did we last print this", which one row answers.
    await recordPrintRun(db, shopId, "dock_sign");
    const first = await lastPrintedAt(db, shopId, "dock_sign");
    await recordPrintRun(db, shopId, "dock_sign");
    const second = await lastPrintedAt(db, shopId, "dock_sign");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.getTime()).toBeGreaterThanOrEqual(first?.getTime() ?? 0);
    const runs = await printRunsByKey(db, shopId);
    expect([...runs.keys()]).toEqual([printRunKey("dock_sign", "")]);
  });

  it("dates each boat's card on its own", async () => {
    // The subject key is what makes "printed Aug 12" a fact about *this* hull
    // rather than about whichever card was printed last.
    await recordPrintRun(db, shopId, "boat_card", "boat-a");
    await recordPrintRun(db, shopId, "boat_card", "boat-b");
    const runs = await printRunsByKey(db, shopId);
    expect(runs.size).toBe(2);
    expect(runs.get(printRunKey("boat_card", "boat-a"))).toBeDefined();
    expect(await lastPrintedAt(db, shopId, "boat_card", "boat-c")).toBeNull();
  });

  it("never dates another shop's row", async () => {
    await recordPrintRun(db, shopId, "window_sticker");
    expect(await lastPrintedAt(db, otherShopId, "window_sticker")).toBeNull();
    expect(await printRunsByKey(db, otherShopId)).toEqual(new Map());
  });

  it("records the pass under no subject, so the register keeps no diver", async () => {
    // A pass prints from one diver's booking; which diver that was is not a
    // fact this register exists to keep.
    await recordPrintRun(db, shopId, "paper_pass");
    const runs = await printRunsByKey(db, shopId);
    expect([...runs.keys()]).toEqual([printRunKey("paper_pass", "")]);
    expect(runs.get(printRunKey("paper_pass", ""))?.subjectKey).toBe("");
  });
});
