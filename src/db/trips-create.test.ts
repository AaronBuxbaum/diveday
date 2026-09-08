import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { createSeasonEvent } from "./season-events";
import { createTripLens, deleteTripLens } from "./trip-lenses";
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

/**
 * **A departure created inside a live season inherits that season's kind of
 * day** (issue #1492).
 *
 * The link already existed one way round — `season_events.lens_id` is drawn on
 * the storefront band, and the band's own link narrows the public board by
 * `trips.lens_id` — so a shop that wrote "Turtle nesting → After dark" and then
 * put a departure on the board inside that window got a band advertising a
 * kind of day and a narrowed list with nothing on it. Nothing wrote the other
 * half.
 */
describe("the kind of day a new departure starts with", () => {
  const TZ = "America/New_York";
  /** 13:00Z is 09:00 in the shop's summer zone — an ordinary morning. */
  const morning = (day: string) => new Date(`${day}T13:00:00.000Z`);

  async function shopWithSeason(
    range: { startsOn: string; endsOn: string },
    options: { deleteLens?: boolean } = {},
  ) {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(TZ);
    const lens = await createTripLens(db, shop.id, "After dark");
    if (!lens) throw new Error("lens not created");
    await createSeasonEvent(db, shop.id, {
      name: "Turtle nesting",
      note: null,
      ...range,
      lensId: lens.id,
    });
    if (options.deleteLens) await deleteTripLens(db, shop.id, lens.id);
    return { db, shop, lens };
  }

  it("takes the season's word when the shop chose none", async () => {
    const { db, shop, lens } = await shopWithSeason({
      startsOn: "2030-07-01",
      endsOn: "2030-07-31",
    });
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Reef morning",
      startsAt: morning("2030-07-15"),
      endsAt: new Date("2030-07-15T17:00:00.000Z"),
      capacity: 6,
    });
    expect(trip?.lensId).toBe(lens.id);
  });

  it("never overwrites the word the shop chose itself", async () => {
    // A season fills a blank. It is a suggestion about an empty field, not an
    // opinion about a full one.
    const { db, shop } = await shopWithSeason({ startsOn: "2030-07-01", endsOn: "2030-07-31" });
    const own = await createTripLens(db, shop.id, "Easygoing reef");
    if (!own) throw new Error("lens not created");
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Reef morning",
      startsAt: morning("2030-07-15"),
      endsAt: new Date("2030-07-15T17:00:00.000Z"),
      capacity: 6,
      lensId: own.id,
    });
    expect(trip?.lensId).toBe(own.id);
  });

  it("leaves a departure outside every window alone", async () => {
    const { db, shop } = await shopWithSeason({ startsOn: "2030-07-01", endsOn: "2030-07-31" });
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Reef morning",
      startsAt: morning("2030-08-15"),
      endsAt: new Date("2030-08-15T17:00:00.000Z"),
      capacity: 6,
    });
    expect(trip?.lensId).toBeNull();
  });

  it("does not write a kind of day the shop has since deleted", async () => {
    // Deleting one is soft, so `season_events.lens_id` still holds a live id.
    // Defaulting off the raw column would label the departure with a word the
    // public rail no longer renders — visible nowhere, tappable never.
    const { db, shop } = await shopWithSeason(
      { startsOn: "2030-07-01", endsOn: "2030-07-31" },
      { deleteLens: true },
    );
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Reef morning",
      startsAt: morning("2030-07-15"),
      endsAt: new Date("2030-07-15T17:00:00.000Z"),
      capacity: 6,
    });
    expect(trip?.lensId).toBeNull();
  });

  it("asks the shop's own calendar day, not the server's", async () => {
    // A season is a range of dates with no instant in it. 01:00Z on the 1st of
    // August is still 21:00 on July 31st in Key Largo, so the shop's own day is
    // inside the window and the server's is not. Getting this backwards would
    // silently mislabel every evening departure for five hours a day.
    const { db, shop, lens } = await shopWithSeason({
      startsOn: "2030-07-01",
      endsOn: "2030-07-31",
    });
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Night dive",
      startsAt: new Date("2030-08-01T01:00:00.000Z"),
      endsAt: new Date("2030-08-01T04:00:00.000Z"),
      capacity: 6,
    });
    expect(trip?.lensId).toBe(lens.id);
  });
});
