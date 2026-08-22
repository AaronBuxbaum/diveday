import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { createTrip } from "./trips-create";

/**
 * **A departure may only sail on a hull its own shop owns** (issue #679).
 *
 * `createTrip` refused a `diveSiteId` and a `courseId` belonging to another
 * shop, and wrote `boatId` straight through unread. `trips.boat_id`'s foreign
 * key is `references(() => boats.id)` — global, no shop in it — and the board
 * parses the field as a bare `z.uuid()`, so submitting a competitor's boat id
 * was one devtools edit on a `<select>`.
 *
 * Everything downstream of that is cross-tenant: the other shop's vessel name
 * renders on this board's card, the row travels in this shop's export bundle,
 * and the other shop deleting the hull reaches into this shop's departure.
 */
describe("a departure's assigned hull", () => {
  it("is refused when the boat belongs to another shop", async () => {
    const { db, shop } = await seededShopContext();
    const other = await seededShopContext();
    const theirBoat = await createBoat(other.db, other.shop.id, "Their Reef Runner", 6);

    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Morning Reef Dive",
      startsAt: new Date("2026-09-01T12:00:00Z"),
      endsAt: new Date("2026-09-01T16:00:00Z"),
      capacity: 6,
      plannedDives: 2,
      diveMode: "boat",
      boatId: theirBoat.id,
    });

    // Refused outright rather than written with the boat dropped: a departure
    // naming a hull the staffer cannot have meant is not a departure to save.
    expect(trip).toBeNull();
  });

  it("accepts the shop's own hull", async () => {
    const { db, shop } = await seededShopContext();
    const ours = await createBoat(db, shop.id, "Our Reef Runner", 6);

    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Morning Reef Dive",
      startsAt: new Date("2026-09-01T12:00:00Z"),
      endsAt: new Date("2026-09-01T16:00:00Z"),
      capacity: 6,
      plannedDives: 2,
      diveMode: "boat",
      boatId: ours.id,
    });

    expect(trip?.boatId).toBe(ours.id);
  });

  it("is unaffected when no hull is named", async () => {
    // Most departures. A shore dive and an unassigned boat departure both
    // arrive here as no id, and neither has anything to validate.
    const { db, shop } = await seededShopContext();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Shore Dive",
      startsAt: new Date("2026-09-01T12:00:00Z"),
      endsAt: new Date("2026-09-01T14:00:00Z"),
      capacity: 6,
      plannedDives: 1,
      diveMode: "shore",
    });

    expect(trip).not.toBeNull();
    expect(trip?.boatId).toBeNull();
  });
});
