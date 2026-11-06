// @vitest-environment node
import { and, eq, inArray, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";

const { sesSend } = vi.hoisted(() => ({ sesSend: vi.fn() }));
vi.mock("@aws-sdk/client-sesv2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-sesv2")>();
  return {
    ...actual,
    SESv2Client: vi.fn().mockImplementation(function SESv2Client() {
      return { send: sesSend };
    }),
  };
});

// Wrappers that call the real function until a test queues a fault, so the
// best-effort catch blocks of `seatConsequences` run against a real seat.
const { mailFaults } = vi.hoisted(() => ({
  mailFaults: {
    confirmation: [] as unknown[],
    waiverOnJoin: [] as unknown[],
    courseSeat: [] as unknown[],
  },
}));
vi.mock("./notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./notifications")>();
  return {
    ...actual,
    sendStaffSeatingConfirmation: (
      ...args: Parameters<typeof actual.sendStaffSeatingConfirmation>
    ) => {
      if (mailFaults.confirmation.length > 0)
        return Promise.reject(mailFaults.confirmation.shift());
      return actual.sendStaffSeatingConfirmation(...args);
    },
    sendCourseSeatConfirmation: (...args: Parameters<typeof actual.sendCourseSeatConfirmation>) => {
      if (mailFaults.courseSeat.length > 0) return Promise.reject(mailFaults.courseSeat.shift());
      return actual.sendCourseSeatConfirmation(...args);
    },
  };
});
vi.mock("./waiver-issue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./waiver-issue")>();
  return {
    ...actual,
    issueWaiverOnJoin: (...args: Parameters<typeof actual.issueWaiverOnJoin>) => {
      if (mailFaults.waiverOnJoin.length > 0)
        return Promise.reject(mailFaults.waiverOnJoin.shift());
      return actual.issueWaiverOnJoin(...args);
    },
  };
});

import { activityEvents, bookings, people, personRoles, waiverRecords } from "./schema";
import { seatDiver } from "./seat-diver";
import { upcomingTripsWithCounts } from "./trips";

/** The same two seeded departures `bookings.test.ts` works against. */
async function context() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  const fullTrip = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
  if (!open || !fullTrip) throw new Error("expected seeded trips missing");
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, ["owner", "manager"])))
    .limit(1);
  if (!staff) throw new Error("seed has no staff actor");
  return { db, shop, open, fullTrip, actorPersonId: staff.id };
}

/**
 * A seeded diver who is not already on `tripId` — the returning-diver picker's
 * own precondition, so a test can seat one by identity the way every picker
 * does.
 */
async function bookableDiver(db: AppDb, shopId: string, tripId: string) {
  const booked = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
  const bookedIds = new Set(booked.map((row) => row.personId));
  const rows = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "diver")));
  const person = rows.find((row) => !bookedIds.has(row.id));
  if (!person) throw new Error("seed has no bookable diver");
  return person;
}

async function _activityLines(db: AppDb, tripId: string) {
  return await db
    .select({ code: activityEvents.code, params: activityEvents.params })
    .from(activityEvents)
    .where(eq(activityEvents.tripId, tripId));
}

async function _waiverCount(db: AppDb, bookingId: string) {
  const rows = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(eq(waiverRecords.bookingId, bookingId));
  return rows.length;
}

async function _bookingIdentityHold(db: AppDb, bookingId: string) {
  const [row] = await db
    .select({ at: bookings.identityUnconfirmedAt })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row?.at ?? null;
}

const _UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

/** A non-reserved address the reserved-test-domain guard lets through. */
const DELIVERABLE_EMAIL = "delivered@dive.day";

/** Stub a shop whose waiver email can actually go out, and capture the send. */
function deliverableEmailEnv() {
  vi.stubEnv("APP_HOST", "https://diveday.example");
  vi.stubEnv("SES_AWS_REGION", "us-east-1");
  vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
  vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
  sesSend.mockReset().mockResolvedValue({ MessageId: "ses-id" });
  return sesSend;
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
// A demo shop sends no mail; these tests are about mail.
const ctx = fileScopedShopContext({ realShop: true });

afterEach(() => {
  vi.unstubAllEnvs();
  mailFaults.confirmation.length = 0;
  mailFaults.waiverOnJoin.length = 0;
  mailFaults.courseSeat.length = 0;
});

describe("seatDiver consequence failures (the seat stands, the door says so)", () => {
  const heldSeat = async () => {
    const { db, shop, open, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);
    return await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      // A held seat owes no confirmation, so it takes the waiver-on-join path.
      diver: { personId: diver.id, fromNameMatch: { typedName: "Someone Else Entirely" } },
      entry: "roster",
      refusals: "specific",
    });
  };

  it.each([
    ["an Error", new Error("ses down")],
    ["a thrown string", "ses down"],
  ])("reports not_sent and failed when the confirmation throws %s", async (_label, fault) => {
    const { db, shop, open, actorPersonId } = await context();
    deliverableEmailEnv();
    mailFaults.confirmation.push(fault);

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "Fault Fay", email: DELIVERABLE_EMAIL },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({ ok: true, confirmation: "not_sent", waiver: "failed" });
  });

  it.each([
    ["an Error", new Error("template gone")],
    ["a thrown string", "template gone"],
  ])("reports failed when a held seat's waiver throws %s", async (_label, fault) => {
    mailFaults.waiverOnJoin.push(fault);

    expect(await heldSeat()).toMatchObject({
      ok: true,
      identityUnconfirmed: true,
      waiver: "failed",
    });
  });

  it.each([
    ["an Error", new Error("materials mail down")],
    ["a thrown string", "materials mail down"],
  ])("still seats a held diver when the course materials mail throws %s", async (_label, fault) => {
    mailFaults.courseSeat.push(fault);

    expect(await heldSeat()).toMatchObject({ ok: true, identityUnconfirmed: true });
    expect(mailFaults.courseSeat).toHaveLength(0);
  });
});
