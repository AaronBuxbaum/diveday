import { describe, expect, it } from "vitest";
import { eventTablesIn, findUnscopedEventReads } from "./check-event-scope.mjs";

const TABLES = ["rollCallEvents", "executedDives"];
const lines = (source) =>
  findUnscopedEventReads(source, TABLES).findings.map((finding) => finding.line);

describe("a read of an event table", () => {
  it("passes when it names the shop", () => {
    expect(
      lines(`
        db.select()
          .from(rollCallEvents)
          .where(and(eq(rollCallEvents.shopId, shopId), eq(rollCallEvents.tripId, tripId)));
      `),
    ).toEqual([]);
  });

  it("is refused by trip alone, the rehearsals.ts shape", () => {
    expect(
      lines(`
        db.selectDistinct({ tripId: rollCallEvents.tripId })
          .from(rollCallEvents)
          .where(inArray(rollCallEvents.tripId, tripIds));
      `),
    ).toEqual([3]);
  });

  it("is never covered by its neighbour's shop filter", () => {
    expect(
      lines(`
        const a = db.select().from(executedDives).where(eq(executedDives.tripId, tripId));
        const b = db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
        const c = db.select().from(executedDives).where(eq(executedDives.shopId, shopId));
      `),
    ).toEqual([2]);
  });

  it("is refused when the shop is only projected, joined or grouped, never filtered", () => {
    // The founder-metrics shape: `shopId` in the select, the join and the
    // groupBy, and every shop's rows read at once.
    expect(
      lines(`
        db.select({ shopId: rollCallEvents.shopId, reachedAt: min(rollCallEvents.occurredAt) })
          .from(rollCallEvents)
          .innerJoin(shops, eq(shops.id, rollCallEvents.shopId))
          .where(eq(rollCallEvents.status, "boarded"))
          .groupBy(rollCallEvents.shopId);
      `),
    ).toEqual([3]);
  });

  it("passes a filter over a set of shops", () => {
    expect(
      lines(`
        db.select().from(rollCallEvents).where(inArray(rollCallEvents.shopId, shopIds));
      `),
    ).toEqual([]);
  });

  it("passes when it says why it is across shops", () => {
    expect(
      lines(`
        // diveday:allow-unscoped-event: the nightly sweep reads every shop.
        db.select().from(rollCallEvents).where(lt(rollCallEvents.occurredAt, cutoff));
      `),
    ).toEqual([]);
  });

  it("ignores tables that are not event tables", () => {
    expect(lines("db.select().from(bookings).where(eq(bookings.tripId, tripId));")).toEqual([]);
  });
});

describe("the event tables", () => {
  it("are the *Events tables that carry a shop", () => {
    expect(
      eventTablesIn(`
export const rollCallEvents = pgTable("roll_call_events", {
  shopId: uuid("shop_id").notNull(),
});
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
});
export const people = pgTable("people", {
  shopId: uuid("shop_id").notNull(),
});
`),
    ).toEqual(["rollCallEvents"]);
  });
});
