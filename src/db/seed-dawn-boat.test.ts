import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rollCallCheckpoints } from "@/lib/roll-call";
import { seededShopContext } from "@/test/db";
import {
  bookings,
  certifications,
  executedDives,
  preDepartureCheckEvents,
  preDepartureChecklistItems,
  rollCallCrewEvents,
  tripAssignments,
  trips,
} from "./schema";
import { DEMO_COMPLETED_TRIP_TITLE } from "./seed-more-trips";

/**
 * **The finished dawn boat reads as a crew that did its job** (UX review
 * 2026-10-13, item 40). Its departure log, "Ready to print if authorities or
 * insurers ever ask", printed five "Not checked", every crew checkpoint
 * "Awaiting roll call", no dive record, and a diver aboard with a card nobody
 * had reviewed, beside a Today card saying everyone was home.
 */
describe("the seeded dawn boat's record", () => {
  async function dawnBoat() {
    const { db, shop } = await seededShopContext();
    const [dawn] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, DEMO_COMPLETED_TRIP_TITLE)));
    if (!dawn) throw new Error("the demo has no dawn boat");
    return { db, shop, dawn };
  }

  it("ticked every pre-departure item before the boat left", async () => {
    const { db, shop, dawn } = await dawnBoat();
    const items = await db
      .select({ id: preDepartureChecklistItems.id })
      .from(preDepartureChecklistItems)
      .where(
        and(
          eq(preDepartureChecklistItems.shopId, shop.id),
          isNull(preDepartureChecklistItems.deletedAt),
        ),
      );
    expect(items.length).toBeGreaterThan(0);
    const checks = await db
      .select()
      .from(preDepartureCheckEvents)
      .where(eq(preDepartureCheckEvents.tripId, dawn.id));
    expect(checks.map((check) => check.checklistItemId).sort()).toEqual(
      items.map((item) => item.id).sort(),
    );
    for (const check of checks) {
      expect(check.status).toBe("checked");
      expect(check.occurredAt.getTime()).toBeLessThan(dawn.startsAt.getTime());
    }
  });

  it("counted every crew member at every checkpoint", async () => {
    const { db, dawn } = await dawnBoat();
    const crew = await db
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .where(eq(tripAssignments.tripId, dawn.id));
    expect(crew.length).toBeGreaterThan(0);
    const counted = await db
      .select()
      .from(rollCallCrewEvents)
      .where(eq(rollCallCrewEvents.tripId, dawn.id));
    for (const { personId } of crew) {
      expect(
        counted
          .filter((row) => row.personId === personId && row.status === "boarded")
          .map((row) => row.checkpoint)
          .sort(),
      ).toEqual([...rollCallCheckpoints(dawn.plannedDives)].sort());
    }
  });

  it("logged its dives inside the time it was out", async () => {
    const { db, dawn } = await dawnBoat();
    const dives = await db.select().from(executedDives).where(eq(executedDives.tripId, dawn.id));
    expect(dives.length).toBeGreaterThan(0);
    for (const dive of dives) {
      expect(dive.enteredAt?.getTime()).toBeGreaterThan(dawn.startsAt.getTime());
      expect(dive.exitedAt?.getTime()).toBeLessThan(dawn.endsAt.getTime());
    }
  });

  it("counted everyone back aboard after each dive, and before the boat docked", async () => {
    // Domain review of layer 2, finding 2: the last count used to land on the
    // docking minute, with dive 2 still in the water at a quarter past eight.
    const { db, dawn } = await dawnBoat();
    const counts = await db
      .select()
      .from(rollCallCrewEvents)
      .where(eq(rollCallCrewEvents.tripId, dawn.id));
    const dives = await db.select().from(executedDives).where(eq(executedDives.tripId, dawn.id));
    for (const count of counts) {
      expect(count.occurredAt.getTime()).toBeLessThan(dawn.endsAt.getTime());
    }
    for (const dive of dives) {
      const after = counts.filter((row) => row.checkpoint === `after_dive_${dive.diveNumber}`);
      expect(after.length).toBeGreaterThan(0);
      for (const count of after) {
        expect(dive.exitedAt?.getTime()).toBeLessThan(count.occurredAt.getTime());
      }
    }
  });

  it("carried nobody whose card was still waiting for a review", async () => {
    const { db, dawn } = await dawnBoat();
    const aboard = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.tripId, dawn.id));
    expect(aboard.length).toBeGreaterThan(0);
    const reviewed = await db
      .select({ personId: certifications.personId, reviewedAt: certifications.reviewedAt })
      .from(certifications)
      .where(eq(certifications.status, "verified"));
    for (const { personId } of aboard) {
      const card = reviewed.find((row) => row.personId === personId && row.reviewedAt);
      expect(card?.reviewedAt?.getTime(), personId).toBeLessThan(dawn.startsAt.getTime());
    }
  });
});
