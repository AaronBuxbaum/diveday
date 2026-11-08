import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { people, trips } from "@/db/schema";
import { countingShopContext } from "@/test/query-count";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "@/test/staff-session";
import { getOrdersIndex } from "../features/orders-index/store";

/**
 * What the Orders index costs (issue #2757): the page reads through one call,
 * `getOrdersIndex`, which fans its reads out beside each other. A ceiling, not
 * invariance, because its fan-out is fixed by construction: one page of the
 * ledger, one of imported history, three permissions, the back office for a
 * reconciler and the two filter labels. The ceiling is the count measured when
 * the reader was written, with every branch taken (an owner, both filters,
 * imported history). If it fails, ask what the change added to the ledger's
 * first screen before raising it.
 */
const ORDERS_INDEX_QUERY_CEILING = 26;

describe("what the Orders index costs", () => {
  it("reads the whole Orders index, every branch taken, under a ceiling", async () => {
    const ctx = await countingShopContext({ history: true });
    const ownerId = await seededStaffPersonId(ctx.uncounted, ctx.shop.id, SEEDED_OWNER_EMAIL);
    const [person] = await ctx.uncounted
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, ctx.shop.id))
      .limit(1);
    const [trip] = await ctx.uncounted
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, ctx.shop.id))
      .orderBy(asc(trips.startsAt))
      .limit(1);
    if (!person || !trip) throw new Error("seeded person or trip missing");

    ctx.reset();
    const index = await getOrdersIndex(ctx.db, ctx.shop, ownerId, {
      filter: { personId: person.id },
      page: 1,
      imported: { filter: { personId: person.id }, page: 1 },
      personFilter: person.id,
      tripFilter: trip.id,
    });
    expect(index.can.reconcilePayments).toBe(true);
    const used = ctx.count();
    expect(
      used,
      `the Orders index sent ${used} queries; see this test's comment before raising the ceiling`,
    ).toBeLessThanOrEqual(ORDERS_INDEX_QUERY_CEILING);
  });

  it("never reads the back office for someone who may not reconcile payments", async () => {
    const ctx = await countingShopContext();
    const ownerId = await seededStaffPersonId(ctx.uncounted, ctx.shop.id, SEEDED_OWNER_EMAIL);
    const captainId = await seededStaffPersonId(ctx.uncounted, ctx.shop.id, SEEDED_CAPTAIN_EMAIL);
    const input = {
      filter: {},
      page: 1,
      imported: null,
      personFilter: undefined,
      tripFilter: undefined,
    };

    ctx.reset();
    const asOwner = await getOrdersIndex(ctx.db, ctx.shop, ownerId, input);
    const ownerCount = ctx.count();
    ctx.reset();
    const asCaptain = await getOrdersIndex(ctx.db, ctx.shop, captainId, input);
    const captainCount = ctx.count();

    expect(asOwner.can.reconcilePayments).toBe(true);
    expect(asCaptain.can.reconcilePayments).toBe(false);
    expect(asCaptain.backOffice.stuckPaymentOperations).toEqual([]);
    expect(captainCount).toBeLessThan(ownerCount);
  });
});
