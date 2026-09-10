import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createGiftBooking } from "./bookings";
import { mergeDiverRecords } from "./diver-merge";
import { enqueueOrderIntegrationEvent } from "./integration-events";
import { saveShopIntegration } from "./integrations";
import { recordRollCall } from "./manifests";
import {
  authProviderAccounts,
  authVerifications,
  bookingGifts,
  bookingPaymentEvents,
  bookingPayments,
  bookings,
  dayCloseouts,
  gearItems,
  gearReservations,
  importedPaymentHistory,
  integrationEvents,
  mediaDeletionAttempts,
  orderLineItems,
  orders,
  people,
  personRoles,
  priorGearAssignments,
  recapPulses,
  rollCallEvents,
  tips,
  tripInvitations,
  tripLastMinutePromoRecipients,
  tripLastMinutePromos,
  trips,
  tripWaitlistEntries,
  userAccounts,
  waiverDeliveries,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * A managed storage origin, the shape `isManagedStorageUrl` accepts. A blob URL
 * on any other host is refused by `queueMediaDeletion` and queues nothing.
 */
const MANAGED_BLOB_HOST = "https://diveday-media.s3.us-east-1.amazonaws.com";

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

  /**
   * `bookings.last_dived_band` is the diver's own answer to "when did you last
   * dive?", and it predates all of the above — it has sat beside two columns
   * that *were* cleared since #1222 without being one of them (issue #1404).
   *
   * The argument for keeping it is that a band is coarse, names nobody, and
   * describes a boat rather than a person. The argument that wins is that a
   * person said it about themselves, and `dive_intent` — which is cleared, and
   * whose docblock cites this column by name as the reason it lives on the
   * booking — is exactly the same kind of value. An asymmetry between the two
   * with no written reason reads to the next person as an oversight, and gets
   * "fixed" in whichever direction they guess.
   */
  it("takes the diver's recency answer with them", async () => {
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
      .set({ lastDivedBand: "over_five_years" })
      .where(eq(bookings.id, booking.id));

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const [after] = await db
      .select({ lastDivedBand: bookings.lastDivedBand })
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    expect(after?.lastDivedBand).toBeNull();
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
describe("anonymizeDiver — a provider login (issue #1594)", () => {
  /**
   * `auth_provider_accounts` is better-auth's `account` model, and every column
   * that matters on it is credential material: `password`, `access_token`,
   * `refresh_token`, `id_token` and two expiries (issue #1588 added them,
   * because the adapter refuses to serve a request while one is missing).
   *
   * Nothing writes a row today — no OAuth provider is configured and no route
   * mounts the handler — so this test inserts one by hand. That is the point of
   * writing it now: the erasure ADR promises the material is destroyed, and the
   * person who eventually enables a provider will be reading a sign-in flow,
   * not this file. A test that fails the moment the delete is removed is what
   * carries the promise across that change.
   */
  it("destroys the tokens a provider sign-in would have left behind", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [diver] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Rafaela Costa",
        email: "rafaela@example.com",
      })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    const [account] = await db
      .insert(userAccounts)
      .values({
        personId: diver.id,
        email: "rafaela@example.com",
        hashedPassword: "argon2-of-something",
        status: "active",
      })
      .returning({ id: userAccounts.id });
    if (!account) throw new Error("fixture insert failed");
    await db.insert(authProviderAccounts).values({
      userAccountId: account.id,
      providerId: "google",
      accountId: "google-subject-1",
      accessToken: "live-access-token",
      refreshToken: "live-refresh-token",
      idToken: "live-id-token",
      password: "a-credentials-hash",
      scope: "openid email",
    });
    // better-auth's `verification` model, the same gap with no foreign key to
    // find it by: `identifier` is the address or the account id and `value` is
    // a live bearer token, so a row surviving an erasure is both the diver's
    // email and a credential that still opens their account.
    await db.insert(authVerifications).values([
      {
        identifier: "rafaela@example.com",
        value: "a-live-reset-token",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
      {
        identifier: account.id,
        value: "a-live-verification-token",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    ]);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    expect(
      await db
        .select()
        .from(authProviderAccounts)
        .where(eq(authProviderAccounts.userAccountId, account.id)),
    ).toEqual([]);
    expect(await db.select().from(authVerifications)).toEqual([]);
  });
});

/**
 * **The giver of a gift is a third party with no record of their own**
 * (security review of the gift slice, finding 5).
 *
 * `booking_gifts` names them by address and by nothing else — no `people` row,
 * no id joining them to anything — so the only handle an erasure has on "gifts
 * this person bought" is the address they are being erased from. Without this
 * sweep, erasing a diver left their name and email standing on every seat they
 * had ever bought somebody else.
 */
describe("anonymizeDiver — the gifts this person bought", () => {
  it("erases the giver on a seat they paid for, not only the seats they dive", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const open = trips.find((trip) => trip.booked < trip.capacity);
    if (!open) throw new Error("no open demo trip");

    // Hannah is a diver here *and* bought Ben a seat. Erasing her has to reach
    // both: her own record, and her name on somebody else's booking.
    const [hannah] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Hannah Liu", email: "Hannah.Liu@example.com" })
      .returning();
    if (!hannah) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: hannah.id, role: "diver" });

    const gift = await createGiftBooking(
      db,
      { actor: "public", shopId: shop.id, tripId: open.id, fullName: "Ben Carter" },
      {
        giverName: "Hannah Liu",
        // Cased differently from the row on file: the match is case-folded,
        // because an address is one address however it was typed.
        giverEmail: "hannah.liu@example.com",
        receiverName: "Ben Carter",
        message: "From Hannah, for your birthday",
      },
    );
    if (!gift.ok) throw new Error(`gift booking failed: ${gift.reason}`);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: hannah.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const [row] = await db
      .select()
      .from(bookingGifts)
      .where(eq(bookingGifts.bookingId, gift.bookingId));
    // The row survives — it is what explains the seat and its money — and the
    // identity does not.
    expect(row).toBeTruthy();
    expect(row?.giverName).not.toBe("Hannah Liu");
    expect(row?.giverEmail).toMatch(/@invalid$/);
    expect(row?.message).toBeNull();
    // Ben is not Hannah: erasing her says nothing about the diver whose seat
    // it is, and his own erasure is his own.
    expect(row?.receiverName).toBe("Ben Carter");
  });
});

/**
 * The six gaps the structural sweep found (issue #1607), each the same shape as
 * something the erasure was already doing one table over.
 *
 * They are written as one fixture because that is how they were found: a single
 * diver with a seat, a rental, an import and a release reaches all six, and
 * every one of them was invisible to a per-table case nobody thought to write.
 * `erasure-coverage.test.ts` is what makes the *next* one visible; these are
 * what fail if a statement below is deleted.
 */
describe("anonymizeDiver — what the coverage sweep found (issue #1607)", () => {
  it("takes the imported money trail, the rental words, and the bounce text", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Kwame Mensah", email: "kwame@example.com" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });

    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .orderBy(trips.id)
      .limit(1);
    if (!trip) throw new Error("expected a seeded departure");
    const [booking] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: diver.id })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("fixture insert failed");

    // 1. The prior system's payment trail, and the receipt document behind it.
    await db.insert(importedPaymentHistory).values({
      shopId: shop.id,
      personId: diver.id,
      occurredOn: "2026-02-11",
      direction: "payment",
      title: "Two-tank Molasses Reef — Kwame Mensah",
      statusLabel: "PAID",
      amountLabel: "$180.00",
      amountCents: 18000,
      currency: "usd",
      paymentReference: "ch_prior_1",
      receiptReference: "RCPT-4471",
      // A **managed** origin, deliberately: `queueMediaDeletion` refuses any
      // other host and returns null, so a `media.invalid` URL would have made
      // this fixture assert nothing about the one thing the new
      // `payment_receipt` kind exists for.
      receiptDocumentUrl: `${MANAGED_BLOB_HOST}/receipts/kwame.pdf`,
      sourceLabel: "Reef Runner POS",
      sourceReference: "ORD-9912",
      stripeReference: "in_prior_1",
      dedupeKey: "ORD-9912",
      importedAt: new Date("2026-02-12T00:00:00.000Z"),
    });

    // 2. The imported rental history beside it.
    const [unit] = await db
      .insert(gearItems)
      .values({ shopId: shop.id, kind: "bcd", label: "BCD 07" })
      .returning({ id: gearItems.id });
    if (!unit) throw new Error("fixture insert failed");
    await db.insert(priorGearAssignments).values({
      shopId: shop.id,
      personId: diver.id,
      gearItemId: unit.id,
      assignedFrom: "2026-02-11",
      assignedUntil: "2026-02-11",
      statusLabel: "RETURNED",
      sourceReference: "RENT-221",
      note: "Kwame prefers the larger size",
      dedupeKey: "RENT-221",
      importedAt: new Date("2026-02-12T00:00:00.000Z"),
    });

    // 3. Staff prose about how a unit came home, on both holder shapes.
    await db.insert(gearReservations).values([
      {
        shopId: shop.id,
        gearItemId: unit.id,
        personId: diver.id,
        reservedFrom: "2026-03-01",
        reservedUntil: "2026-03-02",
        returnedAt: new Date("2026-03-02T18:00:00.000Z"),
        returnNote: "Kwame said the strap tore on the ladder",
      },
      {
        shopId: shop.id,
        gearItemId: unit.id,
        bookingId: booking.id,
        reservedFrom: "2026-03-05",
        reservedUntil: "2026-03-06",
        returnedAt: new Date("2026-03-06T18:00:00.000Z"),
        returnNote: "returned wet, Kwame apologised",
      },
    ]);

    // 4. The payment note, on the row and in the append-only trail behind it.
    await db.insert(bookingPayments).values({
      shopId: shop.id,
      bookingId: booking.id,
      status: "paid",
      amountCents: 18000,
      currency: "usd",
      note: "Kwame paid cash at the counter",
    });
    await db.insert(bookingPaymentEvents).values({
      shopId: shop.id,
      bookingId: booking.id,
      status: "paid",
      amountCents: 18000,
      currency: "usd",
      operation: "manual_mark",
      note: "Kwame paid cash at the counter",
      occurredAt: new Date("2026-03-01T12:00:00.000Z"),
    });

    // 5. The address a last-minute deal was sent to.
    const [promo] = await db
      .insert(tripLastMinutePromos)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        discountPercent: 20,
        code: "LASTCALL20",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      })
      .returning({ id: tripLastMinutePromos.id });
    if (!promo) throw new Error("fixture insert failed");
    await db.insert(tripLastMinutePromoRecipients).values({
      shopId: shop.id,
      tripPromoId: promo.id,
      personId: diver.id,
      email: "kwame@example.com",
    });

    // 6. A staff-typed invoice line, and the hosted pages Stripe mints.
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: diver.id,
        createdByPersonId: owner.id,
        currency: "usd",
        totalCents: 18000,
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_test",
        stripeInvoiceId: "in_test",
        description: "Split with Kwame Mensah's buddy this trip",
        hostedInvoiceUrl: "https://invoice.stripe.com/hosted/kwame",
        invoicePdfUrl: "https://invoice.stripe.com/pdf/kwame",
      })
      .returning({ id: orders.id });
    if (!order) throw new Error("fixture insert failed");
    await db.insert(orderLineItems).values({
      shopId: shop.id,
      orderId: order.id,
      description: "Two tanks for Kwame Mensah",
      unitAmountCents: 18000,
    });
    await db.insert(tips).values({
      shopId: shop.id,
      bookingId: booking.id,
      stripeAccountId: "acct_test",
      stripeSessionId: "cs_test",
      currency: "usd",
      amountCents: 2000,
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test",
    });

    // 7. The day's close-out, whose leftovers copy the diver's name rather than
    // pointing at them.
    await db.insert(dayCloseouts).values({
      shopId: shop.id,
      shopDay: "2026-03-01",
      actorPersonId: owner.id,
      outstanding: {
        departures: [],
        leftovers: [
          {
            id: "waiver:1",
            kind: "waiver",
            subject: "Kwame Mensah",
            detail: "Waiver not signed — Kwame Mensah",
            decision: "carry",
          },
          {
            id: "waiver:2",
            kind: "waiver",
            subject: "Someone Else",
            detail: "Waiver not signed — Someone Else",
            decision: "carry",
          },
        ],
        adminTasks: [],
      },
    });

    // 8. The provider's own words for a bounce, on the release and per channel.
    const [template] = await db
      .select({ id: waiverTemplates.id })
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shop.id))
      .orderBy(waiverTemplates.id)
      .limit(1);
    if (!template) throw new Error("expected a seeded waiver template");
    const [record] = await db
      .insert(waiverRecords)
      .values({
        shopId: shop.id,
        personId: diver.id,
        templateId: template.id,
        templateTitle: "Liability release",
        templateVersion: 1,
        templateBody: "the text as it stood",
        tokenHash: "erasure-sweep-token-hash",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        deliveryError: "550 5.1.1 <kwame@example.com>: recipient rejected",
      })
      .returning({ id: waiverRecords.id });
    if (!record) throw new Error("fixture insert failed");
    await db.insert(waiverDeliveries).values({
      shopId: shop.id,
      waiverRecordId: record.id,
      channel: "email",
      status: "failed",
      detail: "550 5.1.1 <kwame@example.com>: recipient rejected",
      attemptedAt: new Date("2026-03-01T12:00:00.000Z"),
    });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    // The money the shop counts survives; every word about who paid it goes.
    const [payment] = await db
      .select()
      .from(importedPaymentHistory)
      .where(eq(importedPaymentHistory.personId, diver.id));
    expect(payment?.amountCents).toBe(18000);
    expect(payment?.currency).toBe("usd");
    expect(payment?.title).toBeNull();
    expect(payment?.statusLabel).toBeNull();
    expect(payment?.amountLabel).toBeNull();
    expect(payment?.paymentReference).toBeNull();
    expect(payment?.receiptReference).toBeNull();
    expect(payment?.receiptDocumentUrl).toBeNull();
    expect(payment?.sourceLabel).toBeNull();
    expect(payment?.sourceReference).toBeNull();
    expect(payment?.stripeReference).toBeNull();
    expect(payment?.dedupeKey).not.toBe("ORD-9912");

    const [assignment] = await db
      .select()
      .from(priorGearAssignments)
      .where(eq(priorGearAssignments.personId, diver.id));
    expect(assignment?.note).toBeNull();
    expect(assignment?.statusLabel).toBeNull();
    expect(assignment?.sourceReference).toBeNull();
    expect(assignment?.dedupeKey).not.toBe("RENT-221");

    // Both holder shapes: the reservation and its window stay, the prose goes.
    const reservations = await db
      .select()
      .from(gearReservations)
      .where(eq(gearReservations.gearItemId, unit.id));
    expect(reservations).toHaveLength(2);
    expect(reservations.map((row) => row.returnNote)).toEqual([null, null]);

    const [event] = await db
      .select()
      .from(bookingPaymentEvents)
      .where(eq(bookingPaymentEvents.bookingId, booking.id));
    expect(event?.note).toBeNull();
    expect(event?.amountCents).toBe(18000);

    const [recipient] = await db
      .select()
      .from(tripLastMinutePromoRecipients)
      .where(eq(tripLastMinutePromoRecipients.personId, diver.id));
    expect(recipient).toBeDefined();
    expect(recipient?.email).not.toBe("kwame@example.com");

    const [waiver] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, record.id));
    expect(waiver?.deliveryError).toBeNull();
    const [delivery] = await db
      .select()
      .from(waiverDeliveries)
      .where(eq(waiverDeliveries.waiverRecordId, record.id));
    expect(delivery?.detail).toBeNull();
    expect(delivery?.status).toBe("failed");

    // Staff free text on the invoice form, which the export bundles already
    // exclude as third-party-naming.
    const [erasedOrder] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(erasedOrder?.description).toBeNull();
    expect(erasedOrder?.hostedInvoiceUrl).toBeNull();
    const [line] = await db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, order.id));
    expect(line?.description).toBe("[redacted]");
    expect(line?.unitAmountCents).toBe(18000);

    // The hosted tip page renders the address it was minted with.
    const [tip] = await db.select().from(tips).where(eq(tips.bookingId, booking.id));
    expect(tip?.checkoutUrl).toBeNull();
    expect(tip?.amountCents).toBe(2000);

    // The close-out's leftovers keep their count and lose the name. The
    // bystander's row is untouched, which is what the word-boundary match buys.
    const [closeout] = await db.select().from(dayCloseouts).where(eq(dayCloseouts.shopId, shop.id));
    const leftovers = closeout?.outstanding.leftovers ?? [];
    expect(leftovers).toHaveLength(2);
    expect(leftovers[0]?.subject).toBe("[redacted]");
    expect(leftovers[0]?.detail).toBe("[redacted]");
    expect(leftovers[0]?.decision).toBe("carry");
    expect(leftovers[1]?.subject).toBe("Someone Else");

    // The receipt document itself, retired through the same durable ledger
    // every other blob deletion uses rather than a second mechanism.
    const queued = await db
      .select()
      .from(mediaDeletionAttempts)
      .where(
        and(
          eq(mediaDeletionAttempts.shopId, shop.id),
          eq(mediaDeletionAttempts.kind, "payment_receipt"),
        ),
      );
    expect(queued.map((row) => row.url)).toEqual([`${MANAGED_BLOB_HOST}/receipts/kwame.pdf`]);
    expect(queued.every((row) => row.status === "pending")).toBe(true);
  });
});

/**
 * **The erasure is one transaction, so a foreign key that refuses is not a
 * partial erasure — it is no erasure at all** (issue #1616).
 *
 * `scrub` hard-deletes the erased diver's `trip_waitlist_entries`, and
 * `trip_invitations` used to carry a `waitlist_entry_id` referencing that table
 * with no `onDelete`. One populated row would have raised 23503 and rolled the
 * whole scrub back: the owner presses Erase, no error they can act on reaches
 * them, and every redaction is silently undone.
 *
 * The column was dead — both insert sites in `src/db/trip-invitations.ts` write
 * `date_request` or `direct` — so it is dropped rather than sequenced around
 * (H-49).
 *
 * **This test does not stop the hazard coming back, and an earlier draft of
 * this docblock claimed it did.** A `security-reviewer` pass made the point:
 * once the column is gone, no arrangement of rows can construct the failure, so
 * this would have passed against the *pre-fix* schema too. What it is, honestly,
 * is a state assertion — a diver holding both a wait-list entry and an
 * invitation on one departure comes out the other side erased. Worth keeping,
 * worth not overselling.
 *
 * The thing that closes the class is in `erasure-coverage.test.ts`: an
 * assertion over the schema that no foreign key points at a table the scrub
 * hard-deletes from unless it cascades or its own rows go first. That one fails
 * with the column restored, and names it.
 *
 * It still asserts on a *later* redaction rather than on the delete itself,
 * which is right for a different reason: a rollback leaves every table
 * untouched, so the wait-list rows being gone is ambiguous evidence and
 * `people.anonymized_at` being stamped is not.
 */
describe("anonymizeDiver — a wait-listed diver who was also invited (issue #1616)", () => {
  it("erases through, rather than rolling the whole transaction back", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Lucia Ferreira", email: "lucia@example.com" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });

    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .orderBy(trips.id)
      .limit(1);
    if (!trip) throw new Error("expected a seeded departure");

    await db.insert(tripWaitlistEntries).values({
      shopId: shop.id,
      tripId: trip.id,
      personId: diver.id,
    });
    // The invitation that used to point at that entry. `direct` is what a real
    // writer produces; the point is that an invitation and a wait-list entry
    // coexist for one diver on one departure at erasure time.
    await db.insert(tripInvitations).values({
      shopId: shop.id,
      tripId: trip.id,
      source: "direct",
      personId: diver.id,
      createdByPersonId: owner.id,
    });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const [row] = await db.select().from(people).where(eq(people.id, diver.id));
    expect(row?.anonymizedAt).not.toBeNull();
    expect(row?.email).toBeNull();
    expect(
      await db.select().from(tripWaitlistEntries).where(eq(tripWaitlistEntries.personId, diver.id)),
    ).toEqual([]);
  });
});
