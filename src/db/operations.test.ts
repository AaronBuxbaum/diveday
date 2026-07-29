// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { addInternalNote, listBookingNotes, listTripActivity } from "./operations";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

describe("staff-only operational context", () => {
  it("adds a private booking note and a plain-language activity event", async () => {
    const { db, shop } = await seededShopContext();
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
    if (!trip) throw new Error("expected a booked trip");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    const [actor] = await listStaff(db, shop.id);
    if (!rosterEntry || !actor) throw new Error("expected seeded people");

    await expect(
      addInternalNote(db, {
        shopId: shop.id,
        bookingId: rosterEntry.booking.id,
        actorPersonId: actor.person.id,
        body: "  Prefers the shaded bench during setup.  ",
      }),
    ).resolves.toMatchObject({ body: "Prefers the shaded bench during setup." });

    expect(await listBookingNotes(db, shop.id, trip.id)).toHaveLength(1);
    expect((await listTripActivity(db, shop.id, trip.id))[0]?.message).toBe(
      `${actor.person.fullName} added a private note about ${rosterEntry.person.fullName}`,
    );
  });

  it("refuses blank notes and cross-shop booking access", async () => {
    const { db, shop } = await seededShopContext();
    const [actor] = await listStaff(db, shop.id);
    if (!actor) throw new Error("expected seeded staff");
    await expect(
      addInternalNote(db, {
        shopId: shop.id,
        bookingId: "00000000-0000-4000-8000-000000000099",
        actorPersonId: actor.person.id,
        body: "note",
      }),
    ).resolves.toBeNull();
    await expect(
      addInternalNote(db, {
        shopId: shop.id,
        bookingId: "00000000-0000-4000-8000-000000000099",
        actorPersonId: actor.person.id,
        body: "   ",
      }),
    ).resolves.toBeNull();
  });
});
