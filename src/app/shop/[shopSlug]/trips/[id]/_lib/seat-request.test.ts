import { and, eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getBookableDiver } from "@/db/divers";
import { askForDate } from "@/db/interests";
import { people, personRoles, shops } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
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
    const read = await readSeatRequest(ctx.db, {
      shopId: ctx.shop.id,
      tripId: trip.id,
      request: id,
      typed: "",
    });
    if (read === null || read === "missing") throw new Error("request not read");
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
    const read = await readSeatRequest(ctx.db, {
      shopId: ctx.shop.id,
      tripId: trip.id,
      request: id,
      typed: "Somebody else",
    });
    if (read === null || read === "missing") throw new Error("request not read");
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
    const read = await readSeatRequest(ctx.db, {
      shopId: ctx.shop.id,
      tripId: trip.id,
      request: id,
      typed: "",
    });
    if (read === null || read === "missing") throw new Error("request not read");
    expect(read.candidate).toBeNull();
    expect(read.row).toMatchObject({
      personId: null,
      name: "Imani Okafor",
      email: "imani.not.on.file@example.com",
      phone: "+1 305 555 0101",
    });
  });

  it("never reads another shop's request, however exact the id", async () => {
    const trip = await firstTrip();
    const other = await otherShop();
    const { id } = await askForDate(ctx.db, {
      shopId: other.id,
      interest: "Night dive",
      name: "Their Customer",
      email: "their.customer@example.com",
    });
    expect(
      await readSeatRequest(ctx.db, {
        shopId: ctx.shop.id,
        tripId: trip.id,
        request: id,
        typed: "",
      }),
    ).toBe("missing");
  });

  it.each([
    ["junk", "not-a-uuid"],
    ["an injection attempt", "' or 1=1 --"],
    ["a well-formed id nobody has", "6f1c2c9e-0000-4000-8000-000000000000"],
  ])("answers %s as missing", async (_name, request) => {
    const trip = await firstTrip();
    expect(
      await readSeatRequest(ctx.db, { shopId: ctx.shop.id, tripId: trip.id, request, typed: "" }),
    ).toBe("missing");
  });
});
