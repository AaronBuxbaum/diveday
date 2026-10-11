import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { countDiveDays } from "@/lib/founder-metrics";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  claimFounderDigest,
  departureRollCallEvents,
  listShopActivation,
  markStallsAlerted,
  recordShopMilestone,
  releaseFounderDigest,
  syncShopMilestones,
} from "./founder-metrics";
import {
  countDemoEntriesBySource,
  countSetupRequestsBySource,
  countUnnotifiedSetupRequests,
  markSetupRequestNotified,
  recordDemoEntry,
  recordSetupRequest,
} from "./funnel";
import { shopMilestones, shops } from "./schema";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/** The whole seed's calendar, wide enough to hold every seeded departure. */
const ALL_TIME = { from: "2000-01-01", to: "2100-01-01" } as const;

async function milestonesOf(db: AppDb, shopId: string) {
  const rows = await db.select().from(shopMilestones).where(eq(shopMilestones.shopId, shopId));
  return Object.fromEntries(rows.map((row) => [row.milestone, row]));
}

/** The seeded demo shop, turned into a shop DiveDay would count. */
async function realShopContext() {
  const context = ctx;
  await context.db.update(shops).set({ isDemo: false }).where(eq(shops.id, context.shop.id));
  return context;
}

describe("which shops count", () => {
  it("leaves demo shops and shops nobody can sign into out of every number", async () => {
    const { db, shop } = ctx;
    await syncShopMilestones(db);
    // The demo shop is `is_demo`; the seed's listed shops have departures but no login.
    expect(await db.select().from(shopMilestones)).toEqual([]);
    expect(await departureRollCallEvents(db, ALL_TIME)).toEqual([]);

    await recordShopMilestone(db, { shopId: shop.id, milestone: "first_public_booking" });
    expect(await milestonesOf(db, shop.id)).toEqual({});
  });
});

describe("syncShopMilestones", () => {
  it("records what the shop's own rows prove, once, and keeps the first answer", async () => {
    const { db, shop } = await realShopContext();
    await syncShopMilestones(db);
    const first = await milestonesOf(db, shop.id);
    expect(Object.keys(first).sort()).toEqual(
      expect.arrayContaining(["shop_created", "first_departure"]),
    );
    expect(first.shop_created?.reachedAt).toEqual(shop.createdAt);
    // Nothing on a booking row says which door it came through.
    expect(first.first_public_booking).toBeUndefined();

    // A second run moves nothing, even when an earlier instant would now qualify.
    await db
      .update(shops)
      .set({ createdAt: new Date("2000-01-01T00:00:00Z") })
      .where(eq(shops.id, shop.id));
    await syncShopMilestones(db);
    expect((await milestonesOf(db, shop.id)).shop_created?.reachedAt).toEqual(shop.createdAt);
  });

  it("never records a shop nobody can sign into, whatever it schedules", async () => {
    const { db, shop } = await realShopContext();
    await syncShopMilestones(db);
    const shopIds = new Set((await db.select().from(shopMilestones)).map((row) => row.shopId));
    expect([...shopIds]).toEqual([shop.id]);
  });
});

describe("recordShopMilestone", () => {
  it("records a public booking once and never moves it", async () => {
    const { db, shop } = await realShopContext();
    const at = new Date("2026-07-20T15:00:00Z");
    await recordShopMilestone(db, { shopId: shop.id, milestone: "first_public_booking", at });
    await recordShopMilestone(db, {
      shopId: shop.id,
      milestone: "first_public_booking",
      at: new Date("2026-07-22T15:00:00Z"),
    });
    expect((await milestonesOf(db, shop.id)).first_public_booking?.reachedAt).toEqual(at);
  });
});

describe("listShopActivation and markStallsAlerted", () => {
  it("returns each shop's steps and remembers which stall was reported", async () => {
    const { db, shop } = await realShopContext();
    await syncShopMilestones(db);
    const [before] = await listShopActivation(db);
    expect(before?.shopId).toBe(shop.id);
    expect(before?.reached.shop_created).toEqual(shop.createdAt);
    expect(before?.alerted.size).toBe(0);

    await markStallsAlerted(db, [{ shopId: shop.id, milestone: "first_departure" }]);
    const [after] = await listShopActivation(db);
    expect([...(after?.alerted ?? [])]).toEqual(["first_departure"]);
    const [row] = await db
      .select()
      .from(shopMilestones)
      .where(and(eq(shopMilestones.shopId, shop.id), eq(shopMilestones.milestone, "shop_created")));
    expect(row?.stallAlertedAt).toBeNull();
  });
});

describe("departureRollCallEvents", () => {
  it("feeds the north star the shop's departure roll calls, on the shop's own calendar", async () => {
    const { db } = await realShopContext();
    const events = await departureRollCallEvents(db, ALL_TIME);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(event.localDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(countDiveDays(events).shops).toBe(1);

    // A range that holds no departure holds no dive day.
    expect(await departureRollCallEvents(db, { from: "1990-01-01", to: "1990-01-07" })).toEqual([]);
  });
});

describe("the funnel rows", () => {
  const week = {
    startsAt: new Date("2026-10-05T00:00:00Z"),
    endsAt: new Date("2026-10-12T00:00:00Z"),
  };

  it("counts demo entries by source inside the week and nowhere else", async () => {
    const { db } = ctx;
    await recordDemoEntry(db, { source: "home-hero", role: "owner", at: week.startsAt });
    await recordDemoEntry(db, {
      source: "home-hero",
      role: "captain",
      at: new Date("2026-10-11T23:59:00Z"),
    });
    await recordDemoEntry(db, { source: "pricing", role: "owner", at: week.endsAt });
    expect(await countDemoEntriesBySource(db, week)).toEqual([{ source: "home-hero", count: 2 }]);
  });

  it("stores a set-up request and counts the ones whose mail never left", async () => {
    const { db } = ctx;
    const input = {
      shopName: "Reef Line Divers",
      region: "Key Largo",
      runsBoat: true,
      currentSystem: "spreadsheet" as const,
      contactName: "Ana Ruiz",
      email: "ana@reefline.example",
      phone: null,
      locale: "en",
      at: new Date("2026-10-06T12:00:00Z"),
    };
    const sent = await recordSetupRequest(db, { ...input, source: "pricing" });
    await recordSetupRequest(db, { ...input, source: "unknown" });
    await markSetupRequestNotified(db, sent.id);

    expect(sent.runsBoat).toBe(true);
    expect(sent.notifiedAt).toBeNull();
    const counts = await countSetupRequestsBySource(db, week);
    expect(counts.sort((a, b) => a.source.localeCompare(b.source))).toEqual([
      { source: "pricing", count: 1 },
      { source: "unknown", count: 1 },
    ]);
    expect(await countUnnotifiedSetupRequests(db, week)).toBe(1);
  });
});

describe("claimFounderDigest", () => {
  it("lets one run send a week's digest, and lets it go again when the send failed", async () => {
    const { db } = ctx;
    expect(await claimFounderDigest(db, "2026-10-05")).toBe(true);
    expect(await claimFounderDigest(db, "2026-10-05")).toBe(false);
    expect(await claimFounderDigest(db, "2026-10-12")).toBe(true);

    await releaseFounderDigest(db, "2026-10-05");
    expect(await claimFounderDigest(db, "2026-10-05")).toBe(true);
  });
});
