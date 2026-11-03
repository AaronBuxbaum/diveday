import { and, eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getBookableDiver } from "@/db/divers";
import { askForDate } from "@/db/interests";
import {
  bookings,
  dateRequestOfferBookings,
  interests,
  people,
  personRoles,
  shops,
} from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { readSeatRequest } from "./seat-request";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

async function firstTrip() {
  const [trip] = await upcomingTripsWithCounts(ctx.db, ctx.shop.id);
  if (!trip) throw new Error("seeded departure missing");
  return trip;
}

/** A diver on file who is not on `tripId`, with the email a request links by. */
async function diverOffTheBoat(tripId: string) {
  const rows = await ctx.db
    .select({ id: people.id, email: people.email, fullName: people.fullName })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(eq(people.shopId, ctx.shop.id), eq(personRoles.role, "diver"), isNotNull(people.email)),
    );
  for (const row of rows) {
    if (row.email && (await getBookableDiver(ctx.db, ctx.shop.id, tripId, row.id))) {
      return { ...row, email: row.email };
    }
  }
  throw new Error("no seeded diver off the boat");
}

async function otherShop() {
  const [shop] = await ctx.db
    .insert(shops)
    .values({ name: "Other Reef", slug: "other-reef", timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("insert failed");
  return shop;
}

/** Offer `tripId` to request `requestId`, as the Requests ledger does. */
async function offerTo(tripId: string, requestId: string, partySize = 1) {
  const [offer] = await ctx.db
    .insert(interests)
    .values({
      shopId: ctx.shop.id,
      scope: "departure",
      askedBy: "diver",
      tripId,
      parentInterestId: requestId,
      partySize,
      offeredAt: nowDate(),
    })
    .returning();
  if (!offer) throw new Error("setup: offer missing");
  return offer;
}

describe("readSeatRequest", () => {
  it("reads nothing when the URL names no request", async () => {
    const trip = await firstTrip();
    for (const request of [undefined, ""]) {
      expect(
        await readSeatRequest(ctx.db, { shopId: ctx.shop.id, tripId: trip.id, request, typed: "" }),
      ).toBeNull();
    }
  });

  it("offers the diver on file who asked, by id, when nothing was typed", async () => {
    const trip = await firstTrip();
    const diver = await diverOffTheBoat(trip.id);
    const { id } = await askForDate(ctx.db, {
      shopId: ctx.shop.id,
      interest: "Reef",
      name: diver.fullName,
      email: diver.email,
      partySize: 2,
    });
    await offerTo(trip.id, id);
    const read = await readSeatRequest(ctx.db, {
      shopId: ctx.shop.id,
      tripId: trip.id,
      request: id,
      typed: "",
    });
    if (read === null || typeof read === "string") throw new Error("request not read");
    expect(read.row.id).toBe(id);
    expect(read.row.partySize).toBe(2);
    expect(read.candidate?.person.id).toBe(diver.id);
  });

  it("lets what the staffer typed win over the asker", async () => {
    const trip = await firstTrip();
    const diver = await diverOffTheBoat(trip.id);
    const { id } = await askForDate(ctx.db, {
      shopId: ctx.shop.id,
      interest: "Reef",
      name: diver.fullName,
      email: diver.email,
    });
    await offerTo(trip.id, id);
    const read = await readSeatRequest(ctx.db, {
      shopId: ctx.shop.id,
      tripId: trip.id,
      request: id,
      typed: "Somebody else",
    });
    if (read === null || typeof read === "string") throw new Error("request not read");
    expect(read.candidate).toBeNull();
  });

  it("keeps a request from somebody not on file as the new diver's prefill", async () => {
    const trip = await firstTrip();
    const { id } = await askForDate(ctx.db, {
      shopId: ctx.shop.id,
      interest: "Wreck",
      name: "Imani Okafor",
      email: "imani.not.on.file@example.com",
      phone: "+1 305 555 0101",
    });
    await offerTo(trip.id, id);
    const read = await readSeatRequest(ctx.db, {
      shopId: ctx.shop.id,
      tripId: trip.id,
      request: id,
      typed: "",
    });
    if (read === null || typeof read === "string") throw new Error("request not read");
    expect(read.candidate).toBeNull();
    expect(read.row).toMatchObject({
      personId: null,
      name: "Imani Okafor",
      email: "imani.not.on.file@example.com",
      phone: "+1 305 555 0101",
    });
  });

  /**
   * **A request that is gone is one answer, whatever made it so** (dock review
   * F5): another shop's id, a deleted or erased row, junk, or a closed request
   * all read `"gone"`, so the page cannot be used to probe which ids exist, and
   * a stale link never takes the desk's Divers tab down with a 404.
   */
  it("reads another shop's request exactly as it reads one nobody has", async () => {
    const trip = await firstTrip();
    const other = await otherShop();
    const { id } = await askForDate(ctx.db, {
      shopId: other.id,
      interest: "Night dive",
      name: "Their Customer",
      email: "their.customer@example.com",
    });
    const read = (request: string) =>
      readSeatRequest(ctx.db, { shopId: ctx.shop.id, tripId: trip.id, request, typed: "" });
    const theirs = await read(id);
    const nobodys = await read("6f1c2c9e-0000-4000-8000-000000000000");
    expect(theirs).toBe("gone");
    expect(theirs).toEqual(nobodys);
  });

  it.each([
    ["junk", "not-a-uuid"],
    ["an injection attempt", "' or 1=1 --"],
    ["a well-formed id nobody has", "6f1c2c9e-0000-4000-8000-000000000000"],
  ])("answers %s as gone", async (_name, request) => {
    const trip = await firstTrip();
    expect(
      await readSeatRequest(ctx.db, { shopId: ctx.shop.id, tripId: trip.id, request, typed: "" }),
    ).toBe("gone");
  });

  /**
   * Round-2 review, finding 3: a seat for a request is refused on a departure
   * it was never offered, so the band must not offer one, or the refusal
   * lands back on the same button.
   */
  it("answers a request never offered this departure as not offered", async () => {
    const trip = await firstTrip();
    const { id } = await askForDate(ctx.db, {
      shopId: ctx.shop.id,
      interest: "Reef",
      name: "Never Offered",
      email: "never.offered@example.com",
    });
    expect(
      await readSeatRequest(ctx.db, {
        shopId: ctx.shop.id,
        tripId: trip.id,
        request: id,
        typed: "",
      }),
    ).toBe("not_offered");
  });

  it("answers a closed request as gone", async () => {
    const trip = await firstTrip();
    const { id } = await askForDate(ctx.db, {
      shopId: ctx.shop.id,
      interest: "Reef",
      name: "Closed Asker",
      email: "closed.asker@example.com",
    });
    await ctx.db
      .update(interests)
      .set({ closedAt: nowDate(), closedAs: "booked" })
      .where(eq(interests.id, id));
    expect(
      await readSeatRequest(ctx.db, {
        shopId: ctx.shop.id,
        tripId: trip.id,
        request: id,
        typed: "",
      }),
    ).toBe("gone");
  });

  /** An offered party of `partySize` on `tripId`, `seated` of them already booked onto it. */
  async function offeredParty(tripId: string, partySize: number, seated: number) {
    const { id } = await askForDate(ctx.db, {
      shopId: ctx.shop.id,
      interest: "Wreck",
      name: "Party Lead",
      email: "party.lead@example.com",
      partySize,
    });
    const offer = await offerTo(tripId, id, partySize);
    for (let index = 0; index < seated; index += 1) {
      const [person] = await ctx.db
        .insert(people)
        .values({ shopId: ctx.shop.id, fullName: `Party Member ${index}` })
        .returning();
      if (!person) throw new Error("setup: person missing");
      const [booking] = await ctx.db
        .insert(bookings)
        .values({ shopId: ctx.shop.id, tripId, personId: person.id, bookedAs: "diver" })
        .returning();
      if (!booking) throw new Error("setup: booking missing");
      await ctx.db
        .insert(dateRequestOfferBookings)
        .values({ shopId: ctx.shop.id, interestId: offer.id, bookingId: booking.id });
    }
    return id;
  }

  it("counts who is already seated from the party, so the card says how many are left", async () => {
    const trip = await firstTrip();
    const id = await offeredParty(trip.id, 3, 1);
    const read = await readSeatRequest(ctx.db, {
      shopId: ctx.shop.id,
      tripId: trip.id,
      request: id,
      typed: "",
    });
    if (read === null || typeof read === "string") throw new Error("request not read");
    expect(read).toMatchObject({ seated: 1, partySize: 3 });
  });

  it("lets go of a party once every seat is taken", async () => {
    const trip = await firstTrip();
    const id = await offeredParty(trip.id, 2, 2);
    expect(
      await readSeatRequest(ctx.db, {
        shopId: ctx.shop.id,
        tripId: trip.id,
        request: id,
        typed: "",
      }),
    ).toBe("gone");
  });
});
