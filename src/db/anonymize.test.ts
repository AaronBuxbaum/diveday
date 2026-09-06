import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { mergeDiverRecords } from "./diver-merge";
import { enqueueOrderIntegrationEvent } from "./integration-events";
import { saveShopIntegration } from "./integrations";
import { recordRollCall } from "./manifests";
import {
  bookings,
  integrationEvents,
  orders,
  people,
  personRoles,
  recapPulses,
  rollCallEvents,
  trips,
} from "./schema";

async function erasureFixtures() {
  const { db, shop } = await seededShopContext({ history: true });
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("expected the seeded owner");
  return { db, shop, owner };
}

describe("anonymizeDiver — a merged-away record (issue #1014)", () => {
  /**
   * After a merge the source keeps every identifying column, and contact fields
   * only move onto the survivor where the survivor's own was null — so the
   * source's distinct email and phone live on that shell and nowhere else. The
   * shell is unreachable by hand (the diver page redirects a merged id to the
   * survivor before rendering, and that page holds the only erase form), so if
   * erasure does not follow the pointer nothing ever can.
   */
  it("erases the shell a merge left behind", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [source, survivor] = await db
      .insert(people)
      .values([
        {
          shopId: shop.id,
          fullName: "Adaeze Nwosu",
          email: "adaeze@old.example",
          phone: "+1 (305) 555-0142",
          dateOfBirth: "1990-04-02",
          emergencyContactName: "Ngozi Nwosu",
          emergencyContactPhone: "+1 (305) 555-0143",
        },
        { shopId: shop.id, fullName: "Adaeze Nwosu", email: "adaeze@new.example" },
      ])
      .returning();
    if (!source || !survivor) throw new Error("fixture insert failed");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);

    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(merged.ok).toBe(true);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const rows = await db
      .select()
      .from(people)
      .where(inArray(people.id, [source.id, survivor.id]));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.fullName).not.toBe("Adaeze Nwosu");
      expect(row.email).toBeNull();
      expect(row.phone).toBeNull();
      expect(row.dateOfBirth).toBeNull();
      expect(row.emergencyContactName).toBeNull();
      expect(row.emergencyContactPhone).toBeNull();
      expect(row.anonymizedAt).not.toBeNull();
    }
    // The pointer and its stamps survive: what goes is the identity, not the row.
    const shell = rows.find((row) => row.id === source.id);
    expect(shell?.mergedIntoPersonId).toBe(survivor.id);
    expect(shell?.mergedAt).not.toBeNull();
  });
});

describe("anonymizeDiver — the roll-call note (ADR 20260828-a-missing-diver-gets-a-sentence)", () => {
  /**
   * The note is free text a crew member typed at the rail about a person who
   * was unaccounted for, and it sits on a row that legitimately survives an
   * erasure: the boarding fact is a safety record, the sentence about the
   * person is not. It was scrubbed before #1058 deleted the column, and the
   * sweep had to come back with it — H-02's erasure promise is explicitly one
   * of the things pre-pilot status does not relax.
   */
  it("clears what a crew member wrote about a diver who is erased", async () => {
    const { db, shop, owner } = await erasureFixtures();
    // A booking `recordRollCall` will actually accept, picked
    // deterministically. This used to take the shop's *first* booking row —
    // unordered, unfiltered — and never read the recorder's outcome, so
    // whenever heap order handed back a cancelled seat, an unscheduled trip,
    // or a session with no after-dive checkpoint, the recorder refused
    // silently and the test failed three asserts later with no diagnostic
    // (flaked on CI the day the unit shards re-shuffled).
    const [booking] = await db
      .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.shopId, shop.id),
          ne(bookings.status, "cancelled"),
          eq(trips.status, "scheduled"),
          gte(trips.plannedDives, 1),
        ),
      )
      .orderBy(bookings.id)
      .limit(1);
    if (!booking) throw new Error("expected a seeded booking on a scheduled dive trip");
    const recorded = await recordRollCall(db, {
      shopId: shop.id,
      tripId: booking.tripId,
      bookingId: booking.id,
      recordedByPersonId: owner.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      note: "Surfaced 200 m north, picked up by Reef Runner at 14:31.",
    });
    // A refusal here is this test's real failure — fail on it by name rather
    // than on an empty note list downstream.
    expect(recorded).toMatchObject({ ok: true });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const notes = await db
      .select({ note: rollCallEvents.note })
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.shopId, shop.id), eq(rollCallEvents.bookingId, booking.id)));
    expect(notes.length).toBeGreaterThan(0);
    // The boarding fact stays — that is the safety record. The sentence goes.
    expect(notes.every((row) => row.note === null)).toBe(true);
  });
});

describe("anonymizeDiver — the private word (ADR 20260904-reef-all-the-way-down, D40)", () => {
  /**
   * A recap pulse is free text a diver typed on their phone about their day.
   * Nothing bounds it to "the gear was bad" — it is whatever they wanted this
   * shop to know, under their name, and it renders on the Reviews page and
   * ships in every export bundle including the weekly one to shop-owned S3.
   *
   * It shipped with slice 16i and reached no clause in `anonymizeDiver`, which
   * a `security-reviewer` pass found. Nothing mechanical would have: the file
   * scrubs forty-odd person-scoped statements and nothing enumerates the list,
   * so the next table can be forgotten exactly the same way.
   *
   * Both halves are asserted, because the withdrawn case is the one a reader
   * would assume is already handled: `deleted_at` is the diver taking a pulse
   * back, not an erasure, and the words were still on file.
   */
  it("takes the words and leaves the shop's record that it heard something", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const seats = await db
      .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
      .orderBy(bookings.id)
      .limit(2);
    const [live, withdrawn] = seats;
    if (!live || !withdrawn) throw new Error("expected two seeded bookings");

    await db.insert(recapPulses).values([
      {
        shopId: shop.id,
        bookingId: live.id,
        tripId: live.tripId,
        personId: live.personId,
        categories: ["gear"],
        note: "The regulator I was handed free-flowed on the second dive.",
      },
      {
        shopId: shop.id,
        bookingId: withdrawn.id,
        tripId: withdrawn.tripId,
        personId: withdrawn.personId,
        categories: ["boat"],
        note: "Taken back, but the words were on file until now.",
        deletedAt: new Date("2026-08-25T00:00:00.000Z"),
      },
    ]);

    for (const seat of [live, withdrawn]) {
      const erased = await anonymizeDiver(db, {
        shopId: shop.id,
        personId: seat.personId,
        actorPersonId: owner.id,
      });
      expect(erased.ok).toBe(true);
    }

    const rows = await db
      .select({ id: recapPulses.id, note: recapPulses.note, categories: recapPulses.categories })
      .from(recapPulses)
      .where(eq(recapPulses.shopId, shop.id));
    expect(rows.length).toBe(2);
    // The words are the diver's and go.
    expect(rows.every((row) => row.note === null)).toBe(true);
    // The row stays: that a shop received and settled a piece of feedback is
    // its own operational record, the same call the review scrub above makes.
    expect(rows.every((row) => row.categories.length > 0)).toBe(true);
  });
});

describe("anonymizeDiver — the welcome consent (issue #1182)", () => {
  /**
   * `bookings.welcome_shared_at` is the diver saying this departure's crew may
   * know it is a first trip or a long return. Its two siblings on the same row
   * — `dive_intent` and `re_entry_ask` — were cleared from the day they
   * existed; this one shipped with slice 16d and was not, which is the gap.
   *
   * It matters more than a stale flag because of how the cue reads: the words
   * are derived at render from this diver's own booking history, so a stamp
   * left behind keeps the manifest introducing a person who asked to be
   * forgotten. Consent is also not a boarding fact — nothing about the day
   * needs it — so there is no evidence-skeleton argument for keeping it the way
   * there is for the roll-call row above.
   */
  it("takes back the permission a diver gave the crew", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [booking] = await db
      .select({ id: bookings.id, personId: bookings.personId })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
      .orderBy(bookings.id)
      .limit(1);
    if (!booking) throw new Error("expected a seeded booking");
    await db
      .update(bookings)
      .set({ welcomeSharedAt: new Date("2026-07-20T12:00:00Z") })
      .where(eq(bookings.id, booking.id));

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const [after] = await db
      .select({ welcomeSharedAt: bookings.welcomeSharedAt })
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    expect(after?.welcomeSharedAt).toBeNull();
  });
});

describe("anonymizeDiver — the integration outbox (issue #1016)", () => {
  /**
   * `integration_events.payload` is kept 400 days and carries no `person_id`,
   * so a diver's name and email denormalised into it could neither be found nor
   * scrubbed. The fix is that they are never written: the payload names the
   * customer by id, and the name and email are resolved at delivery time. This
   * asserts the property that matters — that an erasure leaves nothing
   * identifying in that table — rather than the implementation that delivers it.
   */
  it("leaves no name or email in an order event's payload", async () => {
    const { db, shop, owner } = await erasureFixtures();
    await saveShopIntegration(db, {
      shopId: shop.id,
      provider: "zapier",
      credentials: { webhookUrl: "https://hooks.zapier.com/hooks/catch/123456/abcdef" },
      settings: { eventTypes: ["order.paid"] },
    });

    const staffIds = await db
      .select({ id: personRoles.personId })
      .from(personRoles)
      .where(inArray(personRoles.role, [...STAFF_ROLES]));
    const staff = new Set(staffIds.map((row) => row.id));
    const orderRows = await db
      .select({ id: orders.id, personId: orders.personId })
      .from(orders)
      .where(eq(orders.shopId, shop.id));
    const order = orderRows.find((row) => !staff.has(row.personId));
    if (!order) throw new Error("expected a seeded order belonging to a diver");
    const [diver] = await db.select().from(people).where(eq(people.id, order.personId)).limit(1);
    if (!diver) throw new Error("expected the order's diver");

    await enqueueOrderIntegrationEvent(db, {
      shopId: shop.id,
      orderId: order.id,
      eventType: "order.paid",
      idempotencyKey: `order:${order.id}:paid`,
    });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const events = await db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.shopId, shop.id));
    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events.map((event) => event.payload));
    expect(serialized).not.toContain(diver.fullName);
    if (diver.email) expect(serialized).not.toContain(diver.email);
    if (diver.phone) expect(serialized).not.toContain(diver.phone);
  });
});
