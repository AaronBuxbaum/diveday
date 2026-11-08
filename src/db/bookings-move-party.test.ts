import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { markArrived } from "@/test/arrivals";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { moveParty as moveSeatParty } from "../features/seat-diver/store";
import { createBooking, moveParty } from "./bookings";
import { formBuddyTeam } from "./buddy-teams";
import type { AppDb } from "./client";
import { activityEvents, bookings } from "./schema";
import { createTrip, listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * **A whole party moves between departures in one step** (#2556, ADR
 * 20261104-move-a-party-as-one). The lead and its live
 * followers land together, keep their party link, are measured against the
 * combined head count, and a refusal anywhere moves nobody.
 */

const ctx = fileScopedShopContext();
const DAY_MS = 24 * 60 * 60 * 1000;

async function seatOn(db: AppDb, shopId: string, tripId: string, fullName: string) {
  const booked = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName,
    email: `${fullName.toLowerCase().replace(/\W+/g, "-")}@example.com`,
  });
  if (!booked.ok) throw new Error(`seating ${fullName} failed: ${booked.reason}`);
  return booked;
}

/** A family of `followers + 1` on the Christ of the Abyss boat, and a next-week boat to move to. */
async function family(followers: number, targetCapacity = 6) {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id);
  const from = upcoming.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!from) throw new Error("seeded trip missing");
  const to = await createTrip(db, {
    shopId: shop.id,
    title: "Two-Tank Reef — next week",
    startsAt: new Date(nowMs() + 40 * DAY_MS),
    endsAt: new Date(nowMs() + 40 * DAY_MS + 4 * 60 * 60 * 1000),
    capacity: targetCapacity,
    plannedDives: 2,
    priceCents: 12_000,
  });
  if (!to) throw new Error("target trip failed");
  const lead = await seatOn(db, shop.id, from.id, "Lena Family");
  const guests = [];
  for (let index = 0; index < followers; index += 1) {
    const guest = await seatOn(db, shop.id, from.id, `Family Guest ${index + 1}`);
    await db
      .update(bookings)
      .set({ partyLeadBookingId: lead.bookingId })
      .where(eq(bookings.id, guest.bookingId));
    guests.push(guest);
  }
  return { db, shop, from, to, lead, guests };
}

function moveFamily(
  db: AppDb,
  shopId: string,
  fromTripId: string,
  toTripId: string,
  leadBookingId: string,
) {
  return moveParty(db, { shopId, fromTripId, toTripId, leadBookingId });
}

async function placement(db: AppDb, ids: string[]) {
  const rows = await Promise.all(
    ids.map(async (id) => {
      const [row] = await db
        .select({ tripId: bookings.tripId, lead: bookings.partyLeadBookingId })
        .from(bookings)
        .where(eq(bookings.id, id));
      return row;
    }),
  );
  return rows;
}

describe("moveParty", () => {
  it("moves the lead and every follower together, keeping the party link", async () => {
    const { db, shop, from, to, lead, guests } = await family(3);
    const outcome = await moveFamily(db, shop.id, from.id, to.id, lead.bookingId);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.moved).toHaveLength(4);
    expect(outcome.moved.map((seat) => seat.toTripId)).toEqual(Array(4).fill(to.id));
    const rows = await placement(db, [lead.bookingId, ...guests.map((guest) => guest.bookingId)]);
    expect(rows.map((row) => row?.tripId)).toEqual(Array(4).fill(to.id));
    // The link survives: a family, not four strangers.
    expect(rows[0]?.lead).toBeNull();
    expect(rows.slice(1).map((row) => row?.lead)).toEqual(Array(3).fill(lead.bookingId));
  });

  it("measures the whole party against the target: one seat short moves nobody", async () => {
    // Four people, three seats on the target.
    const { db, shop, from, to, lead, guests } = await family(3, 3);
    const outcome = await moveFamily(db, shop.id, from.id, to.id, lead.bookingId);
    expect(outcome).toMatchObject({
      ok: false,
      outcome: { reason: expect.stringMatching(/full/) },
    });
    const rows = await placement(db, [lead.bookingId, ...guests.map((guest) => guest.bookingId)]);
    expect(rows.map((row) => row?.tripId)).toEqual(Array(4).fill(from.id));
    expect(rows.slice(1).map((row) => row?.lead)).toEqual(Array(3).fill(lead.bookingId));
  });

  it("fits a party exactly when the target has exactly that many seats", async () => {
    const { db, shop, from, to, lead } = await family(3, 4);
    expect(await moveFamily(db, shop.id, from.id, to.id, lead.bookingId)).toMatchObject({
      ok: true,
    });
  });

  it("moves nobody when one follower has already been checked in", async () => {
    const { db, shop, from, to, lead, guests } = await family(2);
    await markArrived(db, guests[1]?.bookingId ?? "");
    const outcome = await moveFamily(db, shop.id, from.id, to.id, lead.bookingId);
    expect(outcome).toMatchObject({
      ok: false,
      bookingId: guests[1]?.bookingId,
      outcome: { reason: "not_movable" },
    });
    const rows = await placement(db, [lead.bookingId, ...guests.map((guest) => guest.bookingId)]);
    expect(rows.map((row) => row?.tripId)).toEqual(Array(3).fill(from.id));
  });

  it("still refuses a seat on a buddy team, and moves nobody", async () => {
    const { db, shop, from, to, lead, guests } = await family(2);
    const staff = await listStaff(db, shop.id);
    const owner = staff.find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("owner missing");
    const team = await formBuddyTeam(db, {
      shopId: shop.id,
      tripId: from.id,
      members: [
        { kind: "diver", bookingId: guests[0]?.bookingId ?? "" },
        { kind: "diver", bookingId: guests[1]?.bookingId ?? "" },
      ],
      recordedByPersonId: owner.person.id,
    });
    expect(team).toMatchObject({ ok: true });
    expect(await moveFamily(db, shop.id, from.id, to.id, lead.bookingId)).toMatchObject({
      ok: false,
      outcome: { reason: "on_buddy_team" },
    });
    const rows = await placement(db, [lead.bookingId, ...guests.map((guest) => guest.bookingId)]);
    expect(rows.map((row) => row?.tripId)).toEqual(Array(3).fill(from.id));
  });

  it("leaves a cancelled follower behind and is not for a seat that leads nobody", async () => {
    const { db, shop, from, to, lead, guests } = await family(2);
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, guests[1]?.bookingId ?? ""));
    expect(await moveFamily(db, shop.id, from.id, to.id, lead.bookingId)).toMatchObject({
      ok: true,
    });
    const [stayed] = await placement(db, [guests[1]?.bookingId ?? ""]);
    expect(stayed?.tripId).toBe(from.id);
    // A follower is not a lead: nothing to move as a party.
    expect(await moveFamily(db, shop.id, to.id, from.id, guests[0]?.bookingId ?? "")).toMatchObject(
      { ok: false, outcome: { reason: "not_found" } },
    );
  });

  it("refuses the same departure, another shop's trip and a departed boat", async () => {
    const { db, shop, from, to, lead } = await family(1);
    expect(await moveFamily(db, shop.id, from.id, from.id, lead.bookingId)).toMatchObject({
      ok: false,
      outcome: { reason: "target_unavailable" },
    });
    expect(
      await moveFamily(
        db,
        shop.id,
        from.id,
        "00000000-0000-4000-8000-000000000000",
        lead.bookingId,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await moveParty(db, {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        leadBookingId: lead.bookingId,
        now: new Date(from.startsAt.getTime() + 2 * 60 * 60 * 1000),
      }),
    ).toMatchObject({ ok: false, outcome: { reason: "departed" } });
  });

  it("tells each person once, and writes each seat's line on both trails", async () => {
    const { db, shop, from, to, lead, guests } = await family(2);
    const owner = (await listStaff(db, shop.id)).find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("owner missing");
    const email = fakeEmail();
    const moved = await moveSeatParty(
      db,
      {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        leadBookingId: lead.bookingId,
        actorPersonId: owner.person.id,
      },
      {
        emailProvider: email.provider,
        smsProvider: fakeSms().provider,
        whatsAppProviders: new Map(),
        appOrigin: "https://diveday.example",
      },
    );
    expect(moved.ok).toBe(true);
    const told = email.sent.filter((item) => item.kind === "trip_rescheduled");
    const seats = [lead.bookingId, ...guests.map((guest) => guest.bookingId)].sort();
    expect(
      told.map((item) => (item.kind === "trip_rescheduled" ? item.bookingId : "")).sort(),
    ).toEqual(seats);
    const lines = await db
      .select({ code: activityEvents.code, subject: activityEvents.subjectPersonId })
      .from(activityEvents)
      .where(
        and(
          inArray(activityEvents.tripId, [from.id, to.id]),
          inArray(activityEvents.code, ["seat_moved_away", "seat_moved_here"]),
        ),
      );
    expect(lines).toHaveLength(6);
  });

  it("tells nobody when the party does not fit", async () => {
    const { db, shop, from, to, lead } = await family(3, 3);
    const owner = (await listStaff(db, shop.id)).find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("owner missing");
    const email = fakeEmail();
    const moved = await moveSeatParty(
      db,
      {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        leadBookingId: lead.bookingId,
        actorPersonId: owner.person.id,
      },
      { emailProvider: email.provider, appOrigin: null },
    );
    expect(moved.ok).toBe(false);
    expect(email.sent).toEqual([]);
  });
});
