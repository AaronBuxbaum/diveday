// @vitest-environment node
import { and, eq, inArray, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { CertificationLevel } from "@/lib/readiness";
import { seededShopContext } from "@/test/db";
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

import {
  activityEvents,
  bookings,
  certifications,
  people,
  personRoles,
  tripRequirements,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { seatDiver } from "./seat-diver";
import { upcomingTripsWithCounts } from "./trips";

/** The same two seeded departures `bookings.test.ts` works against. */
async function context() {
  const { db, shop } = await seededShopContext();
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

async function activityMessages(db: AppDb, tripId: string) {
  const rows = await db
    .select({ message: activityEvents.message })
    .from(activityEvents)
    .where(eq(activityEvents.tripId, tripId));
  return rows.map((row) => row.message);
}

async function waiverCount(db: AppDb, bookingId: string) {
  const rows = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(eq(waiverRecords.bookingId, bookingId));
  return rows.length;
}

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("seatDiver (the one consequence path behind every staff door)", () => {
  /**
   * The bug this extraction exists for. Booking a diver from their own record
   * called `createBooking` and stopped there — no waiver, ever — so a diver
   * seated that way reached the dock unsigned and nothing upstream said why.
   * The diver-record door is `entry: "roster"` seating an existing person by
   * id: exactly this call.
   */
  it("issues the waiver when a returning diver is seated by identity", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "roster",
      refusals: "specific",
    });

    // The record itself is what this test is about; *what became of it* is the
    // separate contract exercised below.
    expect(result).toMatchObject({ ok: true, personId: diver.id });
    if (!result.ok) throw new Error("expected the diver to be seated");
    expect(await waiverCount(db, result.bookingId)).toBe(1);
  });

  it("leaves the trip's activity trail, phrased for the roster door", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);

    await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "roster",
      refusals: "specific",
    });

    expect(await activityMessages(db, open.id)).toContainEqual(
      expect.stringContaining(`added ${diver.fullName} to the trip`),
    );
  });

  it("says a walk-in was a walk-in on the trail, and takes a diver with no email", async () => {
    const { db, shop, open, actorPersonId } = await context();

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      // The counter's shape: a name and nothing else.
      diver: { fullName: "Counter Cass" },
      entry: "walk_in",
      refusals: "coarse",
    });

    // `not_delivered`, not "issued": a diver with no address on file has a
    // waiver link and no way to have received it. This assertion used to read
    // `waiver: "issued"` and was pinning the bug it was meant to catch.
    expect(result).toMatchObject({ ok: true, personName: "Counter Cass", waiver: "not_delivered" });
    expect(await activityMessages(db, open.id)).toContainEqual(
      expect.stringContaining("added Counter Cass to the trip as a walk-in"),
    );
  });

  it("names the person on the trail even when the door submitted no name", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "walk_in",
      refusals: "coarse",
    });

    expect(result).toMatchObject({ ok: true, personName: diver.fullName });
    expect(await activityMessages(db, open.id)).toContainEqual(
      expect.stringContaining(`added ${diver.fullName} to the trip as a walk-in`),
    );
  });

  it("never stacks a second waiver link on a booking that already has one", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);
    const first = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "roster",
      refusals: "specific",
    });
    if (!first.ok) throw new Error("expected the diver to be seated");

    // Re-seating the same diver is refused outright, which is the guarantee
    // that matters: a retried submission cannot issue a second link.
    const second = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "roster",
      refusals: "specific",
    });

    expect(second).toEqual({ ok: false, reason: "already_booked" });
    expect(await waiverCount(db, first.bookingId)).toBe(1);
  });

  it("records nothing at all when the booking itself is refused", async () => {
    const { db, shop, fullTrip, actorPersonId } = await context();
    const before = await activityMessages(db, fullTrip.id);

    await seatDiver(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      actorPersonId,
      diver: { fullName: "Turned Away Tara" },
      entry: "roster",
      refusals: "specific",
    });

    expect(await activityMessages(db, fullTrip.id)).toEqual(before);
  });
});

/**
 * `waiver` is the only thing telling a door whether its staffer can walk away,
 * so every value has to be earned rather than inferred from "a result came
 * back". The bug these cover: `issueWaiverOnJoin`'s result was read as a
 * boolean, so a link that was issued and then *not* mailed — the no-email
 * counter walk-in, the shop with no email set up, an outright failure to issue
 * — all reported the same success as a delivered email. The staffer saw
 * "Added…", the diver's readiness sat waiting for a signature, and nobody had
 * asked for one.
 */
describe("seatDiver waiver reporting (what a door is allowed to claim)", () => {
  it("reports sent only when the email actually went out", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const send = deliverableEmailEnv();

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "Mailed Mira", email: DELIVERABLE_EMAIL },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({ ok: true, waiver: "sent" });
    expect(send).toHaveBeenCalledOnce();
  });

  /**
   * The normal counter case, and the one the old boolean got most wrong: the
   * walk-in door takes a diver on a name alone precisely so a queue keeps
   * moving, which means no address, which means no email — every time.
   */
  it("reports not_delivered for a walk-in with no address on file", async () => {
    const { db, shop, open, actorPersonId } = await context();
    deliverableEmailEnv();

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "No Email Nell" },
      entry: "walk_in",
      refusals: "coarse",
    });

    expect(result).toMatchObject({ ok: true, waiver: "not_delivered" });
    // Seated regardless — a waiver that could not be mailed never costs a seat.
    if (!result.ok) throw new Error("expected the diver to be seated");
    expect(await waiverCount(db, result.bookingId)).toBe(1);
  });

  it("reports not_delivered when the shop has no email delivery set up", async () => {
    const { db, shop, open, actorPersonId } = await context();
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "");
    vi.stubEnv("SES_FROM_EMAIL", "");

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      // An address on file is not enough; nothing can carry the link.
      diver: { fullName: "Unconfigured Uma", email: DELIVERABLE_EMAIL },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({ ok: true, waiver: "not_delivered" });
  });

  it("reports not_needed when the trip gates no waiver", async () => {
    const { db, shop, open, actorPersonId } = await context();
    deliverableEmailEnv();
    await db
      .update(tripRequirements)
      .set({ requiresWaiver: false })
      .where(eq(tripRequirements.tripId, open.id));

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "No Waiver Nadia", email: DELIVERABLE_EMAIL },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({ ok: true, waiver: "not_needed" });
    if (!result.ok) throw new Error("expected the diver to be seated");
    expect(await waiverCount(db, result.bookingId)).toBe(0);
  });

  /**
   * The failure path a shop can actually reach: the trip demands a waiver and
   * the shop has no active template to issue one from. Nothing exists to hand
   * over, which is a different sentence at the desk than "we have a link you
   * must pass along" — hence its own code.
   */
  it("reports failed when no waiver could be issued at all", async () => {
    const { db, shop, open, actorPersonId } = await context();
    deliverableEmailEnv();
    await db
      .update(waiverTemplates)
      .set({ archivedAt: nowDate() })
      .where(eq(waiverTemplates.shopId, shop.id));

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "No Template Tam", email: DELIVERABLE_EMAIL },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({ ok: true, waiver: "failed" });
    // Still seated: the diver's place on the boat never depends on this.
    if (!result.ok) throw new Error("expected the diver to be seated");
    expect(await waiverCount(db, result.bookingId)).toBe(0);
  });
});

describe("seatDiver refusal granularity (the per-surface parameter)", () => {
  it("keeps each refusal distinct for a surface that asked for specifics", async () => {
    const { db, shop, open, actorPersonId } = await context();

    const unknownPerson = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: UNKNOWN_ID },
      entry: "roster",
      refusals: "specific",
    });
    const unknownTrip = await seatDiver(db, {
      shopId: shop.id,
      tripId: UNKNOWN_ID,
      actorPersonId,
      diver: { fullName: "Nobody Home" },
      entry: "roster",
      refusals: "specific",
    });

    expect(unknownPerson).toEqual({ ok: false, reason: "person_not_found" });
    expect(unknownTrip).toEqual({ ok: false, reason: "trip_unavailable" });
  });

  it("collapses those same refusals to one honest code for the counter", async () => {
    const { db, shop, open, actorPersonId } = await context();

    const unknownPerson = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: UNKNOWN_ID },
      entry: "walk_in",
      refusals: "coarse",
    });
    const unknownTrip = await seatDiver(db, {
      shopId: shop.id,
      tripId: UNKNOWN_ID,
      actorPersonId,
      diver: { fullName: "Nobody Home" },
      entry: "walk_in",
      refusals: "coarse",
    });

    expect(unknownPerson).toEqual({ ok: false, reason: "unavailable" });
    expect(unknownTrip).toEqual({ ok: false, reason: "unavailable" });
  });

  /**
   * "This boat is full" and "they're already on it" are the two refusals a
   * staffer at the counter acts on differently — one sends them to the wait
   * list, the other is a shrug — so the collapse deliberately lets both
   * through. Collapsing them too would be the counter losing information it
   * uses, rather than being spared information it does not.
   */
  it("never collapses the two refusals the counter still acts on", async () => {
    const { db, shop, open, fullTrip, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);
    await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "walk_in",
      refusals: "coarse",
    });

    const again = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "walk_in",
      refusals: "coarse",
    });
    const onFullBoat = await seatDiver(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      actorPersonId,
      diver: { fullName: "Counter Cass" },
      entry: "walk_in",
      refusals: "coarse",
    });

    expect(again).toEqual({ ok: false, reason: "already_booked" });
    expect(onFullBoat).toEqual({ ok: false, reason: "trip_full" });
  });
});

/**
 * The staff doors and the boat's own cert gate (DOM-M6). `seatDiver` never
 * re-implements it — it inherits it from `createBooking` — so what these
 * assert is that all four doors really do reach it and that the counter's
 * deliberate collapse still applies to it.
 */
describe("seatDiver trip admission (the boat's own cert gate reaches every staff door)", () => {
  /** Put one verified card on file, so the shop has actually adjudicated this diver. */
  async function card(db: AppDb, shopId: string, personId: string, level: CertificationLevel) {
    await db.insert(certifications).values({
      shopId,
      personId,
      agency: "padi",
      level,
      identifier: `C-${Math.random().toString(36).slice(2, 10)}`,
      status: "verified",
    });
  }

  async function demandOf(
    db: AppDb,
    shopId: string,
    tripId: string,
    level: CertificationLevel | null,
  ) {
    await db
      .update(tripRequirements)
      .set({ minimumCertificationLevel: level, requiredSpecialties: [], requiresNitrox: false })
      .where(and(eq(tripRequirements.tripId, tripId), eq(tripRequirements.shopId, shopId)));
  }

  it("refuses a staff seating for a diver whose cards cannot reach the trip's requirement", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);
    await card(db, shop.id, diver.id, "open_water");
    await demandOf(db, shop.id, open.id, "divemaster");

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "roster",
      refusals: "specific",
    });

    // The structured detail rides along, because the staff surface's sentence
    // depends on it: "they are not a Divemaster" and "their Deep card isn't on
    // file" call for opposite advice, and only one of them is fixed by adding a
    // card (src/i18n/readiness-labels.ts `tripAdmissionRefusalText`).
    expect(result).toEqual({
      ok: false,
      reason: "trip_prerequisite",
      refusal: {
        requiredLevel: "divemaster",
        heldLevel: "open_water",
        missingSpecialties: [],
        nitroxRequired: false,
      },
    });
    // Refused seatings owe no consequences at all — no seat, no waiver, no trail.
    const seats = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, open.id), eq(bookings.personId, diver.id)));
    expect(seats).toHaveLength(0);
    expect(await activityMessages(db, open.id)).toEqual([]);
  });

  it("collapses the same refusal to the counter's one blunt code", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);
    await card(db, shop.id, diver.id, "open_water");
    await demandOf(db, shop.id, open.id, "divemaster");

    await expect(
      seatDiver(db, {
        shopId: shop.id,
        tripId: open.id,
        actorPersonId,
        diver: { personId: diver.id },
        entry: "walk_in",
        refusals: "coarse",
      }),
      // `toEqual`, not `toMatchObject`: the collapse must also drop the
      // structured detail, or the counter's deliberately blunt one-code
      // vocabulary would grow a specific reason through the back door.
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("still seats the hand-entered walk-in the shop has never carded", async () => {
    // The counter's normal case, and the gate's documented limit: an unknown
    // diver is admitted here and stopped by readiness at the dock instead.
    const { db, shop, open, actorPersonId } = await context();
    await demandOf(db, shop.id, open.id, "divemaster");

    await expect(
      seatDiver(db, {
        shopId: shop.id,
        tripId: open.id,
        actorPersonId,
        diver: { fullName: "Counter Cass" },
        entry: "walk_in",
        refusals: "coarse",
      }),
    ).resolves.toMatchObject({ ok: true, personName: "Counter Cass" });
  });
});
