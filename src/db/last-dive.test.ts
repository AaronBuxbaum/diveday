import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import { lastKnownDive, latestKnownDive, recordLastDive } from "./last-dive";
import { bookings, people, priorVisits, shops, trips } from "./schema";

/**
 * A diver's last known dive (ADR 20261023-last-known-dive): the later of what
 * staff recorded and the diver's own days with the shop, never moved back.
 */

const NOW = new Date("2031-10-14T16:00:00Z");
const TIMEZONE = "America/New_York";
let seq = 0;

async function freshShop(db: AppDb) {
  seq += 1;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Last Dive Shop", slug: `last-dive-shop-${seq}`, timezone: TIMEZONE })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  return shop.id;
}

async function diver(db: AppDb, shopId: string, fullName = "Lena Shore") {
  const person = await createDiver(db, { shopId, fullName });
  if (!person) throw new Error("diver insert failed");
  return person.id;
}

async function seat(
  db: AppDb,
  shopId: string,
  personId: string,
  startsAt: Date,
  options: {
    status?: "booked" | "cancelled" | "no_show";
    participantType?: "diver" | "snorkeler";
  } = {},
) {
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000),
      capacity: 10,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  await db.insert(bookings).values({
    bookedAs: options.participantType ?? "diver",
    participantType: options.participantType ?? "diver",
    shopId,
    tripId: trip.id,
    personId,
    status: options.status ?? "booked",
  });
}

function known(db: AppDb, shopId: string, personId: string, recorded: string | null = null) {
  return lastKnownDive(db, { shopId, personId, timezone: TIMEZONE, now: NOW, recorded });
}

function record(db: AppDb, shopId: string, personId: string, on: string | null) {
  return recordLastDive(db, { shopId, personId, on, now: NOW });
}

describe("latestKnownDive", () => {
  it("takes the latest day, a recorded one first on a tie, and knows nothing from nothing", () => {
    expect(latestKnownDive({ recorded: null, withShop: null, imported: null })).toEqual({
      on: null,
      source: null,
    });
    expect(
      latestKnownDive({ recorded: "2031-03-01", withShop: "2031-09-01", imported: "2030-01-01" }),
    ).toEqual({ on: "2031-09-01", source: "with_shop" });
    expect(
      latestKnownDive({ recorded: "2031-09-01", withShop: "2031-09-01", imported: null }),
    ).toEqual({ on: "2031-09-01", source: "recorded" });
  });
});

describe("lastKnownDive", () => {
  it("moves forward when the diver dives with the shop, in the shop's own day", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const personId = await diver(db, shopId);
    // 01:30 UTC on the 2nd is still the evening of the 1st in New York.
    await seat(db, shopId, personId, new Date("2031-09-02T01:30:00Z"));
    expect(await known(db, shopId, personId, "2031-03-14")).toMatchObject({
      on: "2031-09-01",
      source: "with_shop",
      recorded: "2031-03-14",
    });
  });

  it("keeps a later recorded dive over an older day with the shop", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const personId = await diver(db, shopId);
    await seat(db, shopId, personId, new Date("2031-05-01T13:00:00Z"));
    expect(await known(db, shopId, personId, "2031-10-01")).toMatchObject({
      on: "2031-10-01",
      source: "recorded",
    });
  });

  it("counts only days they dived: not a cancelled, no-show, snorkel or future seat", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const personId = await diver(db, shopId);
    await seat(db, shopId, personId, new Date("2031-01-10T13:00:00Z"));
    await seat(db, shopId, personId, new Date("2031-06-01T13:00:00Z"), { status: "cancelled" });
    await seat(db, shopId, personId, new Date("2031-07-01T13:00:00Z"), { status: "no_show" });
    await seat(db, shopId, personId, new Date("2031-08-01T13:00:00Z"), {
      participantType: "snorkeler",
    });
    await seat(db, shopId, personId, new Date("2031-11-01T13:00:00Z"));
    expect((await known(db, shopId, personId)).withShop).toBe("2031-01-10");
  });

  it("reads an imported visit, and never another shop's days", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const other = await freshShop(db);
    const personId = await diver(db, shopId);
    await db.insert(priorVisits).values({
      shopId,
      personId,
      visitedOn: "2030-03-10",
      dedupeKey: "visit-1",
      importedAt: NOW,
    });
    expect(await known(db, shopId, personId)).toMatchObject({
      on: "2030-03-10",
      source: "imported",
    });
    expect(await known(db, other, personId)).toMatchObject({ on: null, source: null });
  });
});

describe("recordLastDive", () => {
  it("writes a day, corrects it backward, and clears it", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const personId = await diver(db, shopId);
    const stored = async () =>
      (await db.select({ on: people.lastDiveOn }).from(people).where(eq(people.id, personId)))[0]
        ?.on;
    expect(await record(db, shopId, personId, "2031-04-02")).toEqual({ ok: true });
    expect(await stored()).toBe("2031-04-02");
    // A typo put right: earlier than the recorded day, and nothing of the shop's says later.
    expect(await record(db, shopId, personId, "2030-04-02")).toEqual({ ok: true });
    expect(await stored()).toBe("2030-04-02");
    expect(await record(db, shopId, personId, null)).toEqual({ ok: true });
    expect(await stored()).toBeNull();
  });

  it("refuses a day before the shop's own evidence, naming that day", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const personId = await diver(db, shopId);
    await seat(db, shopId, personId, new Date("2031-09-01T13:00:00Z"));
    expect(await record(db, shopId, personId, "2031-08-31")).toEqual({
      ok: false,
      reason: "before_known",
      known: "2031-09-01",
    });
    expect(await record(db, shopId, personId, "2031-09-01")).toEqual({ ok: true });
  });

  it("refuses tomorrow in the shop's zone, and a day that does not exist", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const personId = await diver(db, shopId);
    // NOW is 12:00 on the 14th in New York.
    expect(await record(db, shopId, personId, "2031-10-14")).toEqual({ ok: true });
    expect(await record(db, shopId, personId, "2031-10-15")).toEqual({
      ok: false,
      reason: "future",
    });
    expect(await record(db, shopId, personId, "2031-02-30")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await record(db, shopId, personId, "14/10/2031")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("writes nothing on another shop's diver or a removed one", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const other = await freshShop(db);
    const personId = await diver(db, shopId);
    expect(await record(db, other, personId, "2031-04-02")).toEqual({
      ok: false,
      reason: "not_found",
    });
    await db.update(people).set({ deletedAt: NOW }).where(eq(people.id, personId));
    expect(await record(db, shopId, personId, "2031-04-02")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
