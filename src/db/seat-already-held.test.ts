// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { cancelBooking, createBookingParty } from "./bookings";
import { people } from "./schema";
import { heldSeatOnTrip, tellPartyNotBooked, tellSeatAlreadyHeld } from "./seat-already-held";
import { claimPartySeat, issuePartySeatClaims } from "./seat-claims";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **A claim link tried with the address of someone who already holds a seat**
 * (issue #2381). The claim page answers that exactly as it answers a claim that
 * worked, so this note is the only place the answer goes: to the inbox that owns
 * the seat, naming it and nothing about anyone else.
 */
const ctx = fileScopedShopContext();

async function holder() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (t) => t.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!trip) throw new Error("expected seeded trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Orla Organizer",
      email: "orla@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const [seat] = party.bookings;
  if (!seat) throw new Error("no seat");
  return { db, shop, trip, bookingId: seat.bookingId };
}

describe("claimPartySeat for an address that already holds a seat", () => {
  it("refuses the double seat and names the held seat for the note to its holder", async () => {
    const { db, shop } = ctx;
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (t) => t.title === "Two-Tank Reef — Christ of the Abyss",
    );
    if (!trip) throw new Error("expected seeded trip missing");
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Orla Organizer",
        email: "orla@example.com",
      },
      { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Milo Member" },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const [lead, member] = party.bookings;
    if (!lead || !member) throw new Error("incomplete party");
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    const token = seats.find((seat) => seat.bookingId === member.bookingId)?.claim?.token;
    if (!token) throw new Error("expected a claim link");
    expect(
      await claimPartySeat(db, { token, fullName: "Orla Organizer", email: "orla@example.com" }),
    ).toEqual({
      ok: false,
      reason: "already_booked",
      held: { shopId: shop.id, bookingId: lead.bookingId },
    });
  });
});

describe("tellSeatAlreadyHeld", () => {
  it("tells the holder of the seat which seat they hold, at their own address", async () => {
    const h = await holder();
    const email = fakeEmail();
    expect(
      await tellSeatAlreadyHeld(
        h.db,
        { shopId: h.shop.id, bookingId: h.bookingId, attempt: "claim" },
        { provider: email.provider },
      ),
    ).toBe("sent");
    expect(email.sent).toHaveLength(1);
    const [sent] = email.sent;
    if (sent?.kind !== "seat_already_held") throw new Error("wrong kind");
    expect(sent).toMatchObject({
      to: "orla@example.com",
      tripTitle: h.trip.title,
      heldBookingId: h.bookingId,
    });
    // A note about the reader's own seat: no link to mint, and no field
    // naming the seat the claim was for or whoever tried.
    expect(Object.keys(sent).filter((key) => /url|claim|organizer/i.test(key))).toEqual([]);
  });

  it("sends nothing for a seat that is cancelled, has no address, or belongs to another shop", async () => {
    const h = await holder();
    const email = fakeEmail();
    expect(
      await tellSeatAlreadyHeld(
        h.db,
        {
          shopId: "00000000-0000-4000-8000-000000000000",
          bookingId: h.bookingId,
          attempt: "claim",
        },
        { provider: email.provider },
      ),
    ).toBe("skipped");
    await h.db.update(people).set({ email: null }).where(eq(people.email, "orla@example.com"));
    expect(
      await tellSeatAlreadyHeld(
        h.db,
        { shopId: h.shop.id, bookingId: h.bookingId, attempt: "claim" },
        { provider: email.provider },
      ),
    ).toBe("skipped");
    await h.db
      .update(people)
      .set({ email: "orla@example.com" })
      .where(eq(people.fullName, "Orla Organizer"));
    await cancelBooking(h.db, h.shop.id, h.bookingId);
    expect(
      await tellSeatAlreadyHeld(
        h.db,
        { shopId: h.shop.id, bookingId: h.bookingId, attempt: "claim" },
        { provider: email.provider },
      ),
    ).toBe("skipped");
    expect(email.sent).toHaveLength(0);
  });

  it("stops after five a seat an hour, so a loop of claims is not a mail bomb", async () => {
    const h = await holder();
    const email = fakeEmail();
    const results: string[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      results.push(
        await tellSeatAlreadyHeld(
          h.db,
          { shopId: h.shop.id, bookingId: h.bookingId, attempt: "claim" },
          { provider: email.provider, now: new Date(Date.UTC(2026, 9, 16, 12, 0, attempt)) },
        ),
      );
    }
    expect(results.filter((r) => r === "sent")).toHaveLength(5);
    expect(results.slice(5)).toEqual(["throttled", "throttled"]);
    expect(email.sent).toHaveLength(5);
  });

  it("never throws at the caller when the provider does", async () => {
    const h = await holder();
    const email = fakeEmail(undefined, {
      async send() {
        throw new Error("ses down");
      },
    });
    expect(
      await tellSeatAlreadyHeld(
        h.db,
        { shopId: h.shop.id, bookingId: h.bookingId, attempt: "claim" },
        { provider: email.provider },
      ),
    ).toBe("not_sent");
  });
});

/** The public booking form's half (issue #2691). */
describe("heldSeatOnTrip", () => {
  it("finds the live seat an address holds on the departure, however it was typed", async () => {
    const h = await holder();
    expect(
      await heldSeatOnTrip(h.db, {
        shopId: h.shop.id,
        tripId: h.trip.id,
        email: " ORLA@example.com ",
      }),
    ).toEqual({ shopId: h.shop.id, bookingId: h.bookingId });
  });

  it("finds nothing for another address, another shop, or a cancelled seat", async () => {
    const h = await holder();
    expect(
      await heldSeatOnTrip(h.db, {
        shopId: h.shop.id,
        tripId: h.trip.id,
        email: "milo@example.com",
      }),
    ).toBeNull();
    expect(
      await heldSeatOnTrip(h.db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        tripId: h.trip.id,
        email: "orla@example.com",
      }),
    ).toBeNull();
    await cancelBooking(h.db, h.shop.id, h.bookingId);
    expect(
      await heldSeatOnTrip(h.db, {
        shopId: h.shop.id,
        tripId: h.trip.id,
        email: "orla@example.com",
      }),
    ).toBeNull();
  });
});

describe("tellPartyNotBooked", () => {
  it("tells the lead the party did not book, and stops after five an hour", async () => {
    const h = await holder();
    const email = fakeEmail();
    const results: string[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      results.push(
        await tellPartyNotBooked(
          h.db,
          {
            shopId: h.shop.id,
            tripId: h.trip.id,
            to: "lena@example.com",
            leadName: "Lena Lead",
            locale: "en-US",
          },
          { provider: email.provider },
        ),
      );
    }
    expect(results).toEqual(["sent", "sent", "sent", "sent", "sent", "throttled"]);
    expect(email.sent[0]).toMatchObject({
      kind: "party_not_booked",
      to: "lena@example.com",
      tripTitle: h.trip.title,
    });
  });

  it("sends nothing for a departure that is not this shop's", async () => {
    const h = await holder();
    const email = fakeEmail();
    expect(
      await tellPartyNotBooked(
        h.db,
        {
          shopId: "00000000-0000-4000-8000-000000000000",
          tripId: h.trip.id,
          to: "lena@example.com",
          leadName: "Lena Lead",
          locale: "en-US",
        },
        { provider: email.provider },
      ),
    ).toBe("skipped");
    expect(email.sent).toEqual([]);
  });
});
