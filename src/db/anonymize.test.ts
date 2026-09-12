import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { STAFF_ROLES } from "@/lib/authz";
import type { DeleteCustomerResult } from "@/lib/payments/customers";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createGiftBooking } from "./bookings";
import { mergeDiverRecords } from "./diver-merge";
import { enqueueOrderIntegrationEvent } from "./integration-events";
import { saveShopIntegration } from "./integrations";
import { recordRollCall } from "./manifests";
import { listOwedProcessorErasures } from "./processor-erasure";
import {
  authProviderAccounts,
  authVerifications,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingGifts,
  bookingPaymentEvents,
  bookingPayments,
  bookings,
  dayCloseouts,
  formDrafts,
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
  processorErasureObligations,
  recapPulses,
  rollCallEvents,
  shops,
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
import { upsertShopStripeAccount } from "./stripe-accounts";
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

/**
 * **A draft is a work queue, and it was outliving the erasure by up to a week**
 * (issue #1620).
 *
 * `form_drafts.person_id` is the staffer who typed, not the person typed about,
 * so nothing person-scoped reaches a `new_diver` draft holding this diver's
 * name, address, phone and emergency contact. The bound the table was trusted
 * for is weaker than it reads: `NEVER_DRAFTED` keeps card, medical and token
 * fields out but not those four, and the retention prune runs weekly against a
 * one-day cutoff.
 *
 * Two halves, because a sweep that took the whole table would be worse than the
 * gap: the erased diver's draft goes, and a colleague's draft about somebody
 * else stays.
 */
describe("anonymizeDiver — an unfinished form about the erased diver (issue #1620)", () => {
  it("drops the draft that names them and leaves the one that does not", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Tomás Herrera", email: "tomas@example.com" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });

    // Both drafts are authored by the owner — which is the whole difficulty.
    // One is *about* the diver being erased; the other is about a stranger.
    await db.insert(formDrafts).values([
      {
        shopId: shop.id,
        personId: owner.id,
        form: "new_diver",
        fields: {
          fullName: "Tomás Herrera",
          email: "tomas@example.com",
          phone: "+34 600 555 019",
          emergencyContactName: "Pilar Herrera",
        },
      },
      {
        shopId: shop.id,
        personId: owner.id,
        form: "took_a_call",
        fields: { fullName: "Someone Else", email: "someone.else@example.com" },
      },
    ]);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const left = await db.select().from(formDrafts).where(eq(formDrafts.shopId, shop.id));
    expect(left).toHaveLength(1);
    expect(left[0]?.form).toBe("took_a_call");
    // Nothing of the erased diver survives in what is left, including the
    // emergency contact — a third party's details that only this draft held.
    expect(JSON.stringify(left)).not.toContain("Tomás Herrera");
    expect(JSON.stringify(left)).not.toContain("tomas@example.com");
    expect(JSON.stringify(left)).not.toContain("Pilar Herrera");
  });
});

/**
 * **A duplicate person keeps the address the key sweep cannot reach**
 * (issue #1622).
 *
 * `people_shop_email_unique` is partial on live rows, so a soft-deleted
 * duplicate legitimately shares an address with the survivor. Where that
 * duplicate was never merged, `person_id` points at it rather than at the
 * erased record — and a sweep keyed on `person_id` alone leaves the address
 * standing on a table `src/db/export.ts` carries out of the shop.
 *
 * Every other durable address column in the erasure already has this second
 * sweep. This is the one that did not.
 */
describe("anonymizeDiver — a deal sent to an unmerged duplicate (issue #1622)", () => {
  it("redacts the address on the duplicate's recipient row too", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const shared = "marisol@example.com";
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Marisol Vega", email: shared })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });
    // The duplicate is soft-deleted, which is what makes the shared address
    // legal under the partial unique index — and what leaves it unmerged.
    const [duplicate] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Marisol Vega",
        email: shared,
        deletedAt: new Date("2026-02-01T00:00:00.000Z"),
      })
      .returning({ id: people.id });
    if (!duplicate) throw new Error("fixture insert failed");

    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .orderBy(trips.id)
      .limit(1);
    if (!trip) throw new Error("expected a seeded departure");
    const [promo] = await db
      .insert(tripLastMinutePromos)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        discountPercent: 15,
        code: "DUPLICATE15",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      })
      .returning({ id: tripLastMinutePromos.id });
    if (!promo) throw new Error("fixture insert failed");
    await db.insert(tripLastMinutePromoRecipients).values([
      { shopId: shop.id, tripPromoId: promo.id, personId: diver.id, email: shared },
      { shopId: shop.id, tripPromoId: promo.id, personId: duplicate.id, email: shared },
    ]);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const rows = await db
      .select()
      .from(tripLastMinutePromoRecipients)
      .where(eq(tripLastMinutePromoRecipients.tripPromoId, promo.id));
    // Both rows survive — how many people a deal reached is the shop's own
    // record — and neither carries the address any more.
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.email)).not.toContain(shared);
    // Redacted per row, so two erased people never collapse into one value.
    expect(new Set(rows.map((row) => row.email)).size).toBe(2);
  });
});

/**
 * **The draft sweep must not depend on the diver having an address.**
 *
 * `people.email` is nullable — a phone-only walk-in is an ordinary record — and
 * the first cut of this sweep ran only under `if (ctx.email)`. Their draft
 * survived the erasure while `erasure-coverage.test.ts` read green, because the
 * static sweep sees the `delete` statement and not the `if` above it. A
 * `security-reviewer` pass caught it; this is the case that would have.
 */
describe("anonymizeDiver — a draft about a diver with no address (issue #1620)", () => {
  it("reaches it by phone, and by name when there is no phone either", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [byPhone] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Ingrid Solberg", phone: "+47 900 55 019" })
      .returning({ id: people.id });
    const [byName] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Kwabena Osei-Bonsu" })
      .returning({ id: people.id });
    if (!byPhone || !byName) throw new Error("fixture insert failed");
    await db.insert(personRoles).values([
      { personId: byPhone.id, role: "diver" },
      { personId: byName.id, role: "diver" },
    ]);
    expect((await db.select().from(people).where(eq(people.id, byPhone.id)))[0]?.email).toBeNull();

    await db.insert(formDrafts).values([
      {
        shopId: shop.id,
        personId: owner.id,
        form: "new_diver",
        fields: { fullName: "Ingrid Solberg", phone: "+47 900 55 019" },
      },
      {
        shopId: shop.id,
        personId: owner.id,
        form: "took_a_call",
        fields: { fullName: "Kwabena Osei-Bonsu", reply: "call back after the weekend" },
      },
    ]);

    for (const person of [byPhone, byName]) {
      const erased = await anonymizeDiver(db, {
        shopId: shop.id,
        personId: person.id,
        actorPersonId: owner.id,
      });
      expect(erased.ok).toBe(true);
    }

    expect(await db.select().from(formDrafts).where(eq(formDrafts.shopId, shop.id))).toEqual([]);
  });
});

/**
 * **Neither address sweep may cross a tenant**, and an address is exactly the
 * value that legitimately exists in two shops at once — the same diver on the
 * same coast. Both statements carry `shop_id` today; nothing pinned it, so
 * deleting either clause left every test in this file green while one owner's
 * erasure reached into another shop's rows. A `security-reviewer` pass named
 * that as the highest-consequence one-line regression these sweeps make
 * available.
 */
describe("anonymizeDiver — the address sweeps stop at the shop boundary", () => {
  it("leaves another shop's draft and recipient row alone", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const shared = "nadia@example.com";
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-boundary", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!other) throw new Error("fixture insert failed");
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Nadia Haddad", email: shared })
      .returning({ id: people.id });
    const [elsewhere] = await db
      .insert(people)
      .values({ shopId: other.id, fullName: "Nadia Haddad", email: shared })
      .returning({ id: people.id });
    if (!diver || !elsewhere) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });

    await db.insert(formDrafts).values({
      shopId: other.id,
      personId: elsewhere.id,
      form: "new_diver",
      fields: { fullName: "Nadia Haddad", email: shared },
    });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const theirs = await db.select().from(formDrafts).where(eq(formDrafts.shopId, other.id));
    expect(theirs).toHaveLength(1);
    expect(theirs[0]?.fields.email).toBe(shared);
  });
});

/**
 * The erasure ledger used to read `orders` and nothing else, so a diver who
 * only ever tipped — or who paid through a checkout that never became an
 * order — was erased locally and left no trace of what Stripe still held
 * (issue #1621, ADR 20260803-processor-erasure-obligations).
 *
 * A Checkout Session is a snapshot: Stripe can expire one but rewrites neither
 * `customer_email` nor `customer_details`, so it is owed manually like an
 * invoice. The Customer beside it is raised only when Stripe reported minting
 * one, because `customer_creation: "if_required"` means most sessions mint
 * none.
 */
describe("anonymizeDiver — the Stripe objects that live outside orders (issue #1621)", () => {
  /** A provider that answers the same way every time and counts its calls. */
  function providerReturning(result: DeleteCustomerResult) {
    return { deleteCustomer: vi.fn().mockResolvedValue(result) };
  }

  async function obligationsFor(
    db: Awaited<ReturnType<typeof erasureFixtures>>["db"],
    shopId: string,
  ) {
    const rows = await db
      .select()
      .from(processorErasureObligations)
      .where(eq(processorErasureObligations.shopId, shopId));
    return rows.map((row) => `${row.target}:${row.externalId}`).sort();
  }

  async function seededTripId(
    db: Awaited<ReturnType<typeof erasureFixtures>>["db"],
    shopId: string,
  ) {
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shopId))
      .orderBy(trips.id)
      .limit(1);
    if (!trip) throw new Error("expected a seeded departure");
    return trip.id;
  }

  it("raises the session and the customer for a diver who only ever tipped", async () => {
    const { db, shop, owner } = await erasureFixtures();
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Tipping Tomás", email: "tomas@example.com" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });
    const [booking] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: await seededTripId(db, shop.id), personId: diver.id })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("fixture insert failed");
    await db.insert(tips).values({
      shopId: shop.id,
      bookingId: booking.id,
      stripeAccountId: "acct_test",
      stripeSessionId: "cs_tip",
      stripeCustomerId: "cus_tip",
      currency: "usd",
      amountCents: 2000,
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_tip",
    });
    const provider = providerReturning({ status: "deleted" });

    const result = await anonymizeDiver(
      db,
      { shopId: shop.id, personId: diver.id, actorPersonId: owner.id },
      { customerProvider: provider },
    );
    expect(result.ok).toBe(true);

    // No order, so no invoice snapshot — the ledger names exactly the two
    // objects this tip put at Stripe.
    expect(await obligationsFor(db, shop.id)).toEqual([
      "stripe_checkout_session_snapshot:cs_tip",
      "stripe_customer:cus_tip",
    ]);
    expect(provider.deleteCustomer).toHaveBeenCalledWith(
      "acct_test",
      "cus_tip",
      expect.stringContaining(":customer-delete"),
    );
    // The session is the manual half: nothing automated reaches it.
    const owed = await listOwedProcessorErasures(db, shop.id);
    expect(owed.map((row) => row.target)).toEqual(["stripe_checkout_session_snapshot"]);
  });

  it("raises no customer obligation for a tip Stripe never minted one for", async () => {
    const { db, shop, owner } = await erasureFixtures();
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Abandoned Ama", email: "ama@example.com" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });
    const [booking] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: await seededTripId(db, shop.id), personId: diver.id })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("fixture insert failed");
    await db.insert(tips).values({
      shopId: shop.id,
      bookingId: booking.id,
      stripeAccountId: "acct_test",
      stripeSessionId: "cs_abandoned",
      // Null, because `customer_creation: "if_required"` created none. An
      // obligation raised here would point an owner at an object that never
      // existed.
      stripeCustomerId: null,
      currency: "usd",
      amountCents: 1500,
      // The link is already gone, which is the case the separate read exists
      // for: the `checkoutUrl` UPDATE would not have returned this row.
      checkoutUrl: null,
    });
    const provider = providerReturning({ status: "deleted" });

    await anonymizeDiver(
      db,
      { shopId: shop.id, personId: diver.id, actorPersonId: owner.id },
      { customerProvider: provider },
    );

    expect(await obligationsFor(db, shop.id)).toEqual([
      "stripe_checkout_session_snapshot:cs_abandoned",
    ]);
    expect(provider.deleteCustomer).not.toHaveBeenCalled();
  });

  it("still owes the session snapshot for a completed checkout with no customer pointer", async () => {
    const { db, shop, owner } = await erasureFixtures();
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Settled Sanne", email: "sanne@example.com" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });
    const tripId = await seededTripId(db, shop.id);
    const [booking] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId, personId: diver.id })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("fixture insert failed");
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId,
        // The shape of a row settled before
        // `20260911222255_checkout-stripe-customer` added the column: money
        // took, and no pointer, because there was nowhere to put one. A
        // `completed` row is never read from Stripe again, so unlike a pending
        // one it never self-heals — nothing here will ever tell this null from
        // an abandoned session's.
        status: "completed",
        stripeAccountId: "acct_test",
        stripeSessionId: "cs_pre_column",
        stripeCustomerId: null,
        currency: "usd",
        amountPerDiverCents: 12000,
        totalCents: 12000,
        customerEmail: "sanne@example.com",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_pre_column",
      })
      .returning({ id: bookingCheckouts.id });
    if (!checkout) throw new Error("fixture insert failed");
    await db
      .insert(bookingCheckoutBookings)
      .values({ shopId: shop.id, checkoutId: checkout.id, bookingId: booking.id });
    const provider = providerReturning({ status: "deleted" });

    await anonymizeDiver(
      db,
      { shopId: shop.id, personId: diver.id, actorPersonId: owner.id },
      { customerProvider: provider },
    );

    // H-49 is why there is no backfill, and this is why that is survivable: the
    // session snapshot is owed for every session row whatever this column says,
    // so the owner still files Stripe's data-deletion request rather than being
    // told nothing is owed. The automated customer delete is the half genuinely
    // lost for such a row (`security-reviewer`, 2026-09-12).
    expect(await obligationsFor(db, shop.id)).toEqual([
      "stripe_checkout_session_snapshot:cs_pre_column",
    ]);
    expect(provider.deleteCustomer).not.toHaveBeenCalled();
  });

  it("raises a checkout this diver paid for but holds no seat on", async () => {
    const { db, shop, owner } = await erasureFixtures();
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    const [payer] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Paying Priya", email: "priya@example.com" })
      .returning({ id: people.id });
    const [traveller] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Travelling Tom", email: "tom@example.com" })
      .returning({ id: people.id });
    if (!payer || !traveller) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: payer.id, role: "diver" });
    const tripId = await seededTripId(db, shop.id);
    const [theirSeat] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId, personId: traveller.id })
      .returning({ id: bookings.id });
    if (!theirSeat) throw new Error("fixture insert failed");
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId,
        stripeAccountId: "acct_test",
        stripeSessionId: "cs_party",
        stripeCustomerId: "cus_party",
        currency: "usd",
        amountPerDiverCents: 12000,
        totalCents: 12000,
        customerEmail: "priya@example.com",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_party",
      })
      .returning({ id: bookingCheckouts.id });
    if (!checkout) throw new Error("fixture insert failed");
    await db
      .insert(bookingCheckoutBookings)
      .values({ shopId: shop.id, checkoutId: checkout.id, bookingId: theirSeat.id });
    const provider = providerReturning({ status: "deleted" });

    await anonymizeDiver(
      db,
      { shopId: shop.id, personId: payer.id, actorPersonId: owner.id },
      { customerProvider: provider },
    );

    // The booking join cannot see this checkout at all — the address sweep is
    // the only handle, and it is the one that now feeds the ledger.
    expect(await obligationsFor(db, shop.id)).toEqual([
      "stripe_checkout_session_snapshot:cs_party",
      "stripe_customer:cus_party",
    ]);
  });

  it("folds one customer object reached twice into a single obligation", async () => {
    const { db, shop, owner } = await erasureFixtures();
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Repeat Rina", email: "rina@example.com" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });
    const tripId = await seededTripId(db, shop.id);
    const [booking] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId, personId: diver.id })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("fixture insert failed");
    await db.insert(orders).values({
      shopId: shop.id,
      personId: diver.id,
      createdByPersonId: owner.id,
      currency: "usd",
      totalCents: 18000,
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_rina",
      stripeInvoiceId: "in_rina",
    });
    await db.insert(tips).values({
      shopId: shop.id,
      bookingId: booking.id,
      stripeAccountId: "acct_test",
      stripeSessionId: "cs_rina",
      // The same returning diver, so Stripe reused the customer object her
      // order already named.
      stripeCustomerId: "cus_rina",
      currency: "usd",
      amountCents: 2500,
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_rina",
    });
    // A sole-occupant checkout on her own seat, on that same customer again.
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId,
        stripeAccountId: "acct_test",
        stripeSessionId: "cs_rina_seat",
        stripeCustomerId: "cus_rina",
        currency: "usd",
        amountPerDiverCents: 12000,
        totalCents: 12000,
        customerEmail: "rina@example.com",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_rina_seat",
      })
      .returning({ id: bookingCheckouts.id });
    if (!checkout) throw new Error("fixture insert failed");
    await db
      .insert(bookingCheckoutBookings)
      .values({ shopId: shop.id, checkoutId: checkout.id, bookingId: booking.id });
    const provider = providerReturning({ status: "deleted" });

    await anonymizeDiver(
      db,
      { shopId: shop.id, personId: diver.id, actorPersonId: owner.id },
      { customerProvider: provider },
    );

    // Four objects, four rows: two distinct sessions, one invoice, and one
    // customer no matter how many rows pointed at it. One delete, not three.
    expect(await obligationsFor(db, shop.id)).toEqual([
      "stripe_checkout_session_snapshot:cs_rina",
      "stripe_checkout_session_snapshot:cs_rina_seat",
      "stripe_customer:cus_rina",
      "stripe_invoice_snapshot:in_rina",
    ]);
    expect(provider.deleteCustomer).toHaveBeenCalledTimes(1);
  });

  it("clears the hosted page on a sole-occupant checkout the address sweep already blanked", async () => {
    const { db, shop, owner } = await erasureFixtures();
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Solo Sofia", email: "sofia@example.com" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });
    const tripId = await seededTripId(db, shop.id);
    const [booking] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId, personId: diver.id })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("fixture insert failed");
    // The ordinary self-booked checkout: her own address on her own seat. The
    // address sweep matches it first and nulls `customer_email`, which is
    // exactly the row the sole-occupant sweep used to skip — leaving the
    // hosted page that renders her standing (issue #1607).
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId,
        stripeAccountId: "acct_test",
        stripeSessionId: "cs_sofia",
        stripeCustomerId: "cus_sofia",
        currency: "usd",
        amountPerDiverCents: 12000,
        totalCents: 12000,
        customerEmail: "sofia@example.com",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_sofia",
      })
      .returning({ id: bookingCheckouts.id });
    if (!checkout) throw new Error("fixture insert failed");
    await db
      .insert(bookingCheckoutBookings)
      .values({ shopId: shop.id, checkoutId: checkout.id, bookingId: booking.id });

    await anonymizeDiver(
      db,
      { shopId: shop.id, personId: diver.id, actorPersonId: owner.id },
      { customerProvider: providerReturning({ status: "deleted" }) },
    );

    const [erased] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkout.id));
    expect(erased?.customerEmail).toBeNull();
    expect(erased?.checkoutUrl).toBeNull();
    expect(await obligationsFor(db, shop.id)).toEqual([
      "stripe_checkout_session_snapshot:cs_sofia",
      "stripe_customer:cus_sofia",
    ]);
  });

  it("owes a sole-occupant checkout that carries no address at all", async () => {
    const { db, shop, owner } = await erasureFixtures();
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Nameless Noor", email: "noor@example.com" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });
    const tripId = await seededTripId(db, shop.id);
    const [booking] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId, personId: diver.id })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("fixture insert failed");
    // `startBookingCheckout` takes a non-null address, so nothing writes this
    // row today. It is the shape the ledger has to survive the day the column
    // is nullable at write: the booking join is then the only handle on the
    // session, and a sweep that reads its handles out of `returning()` on an
    // address-filtered UPDATE hands back nothing (issue #1621).
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId,
        stripeAccountId: "acct_test",
        stripeSessionId: "cs_noor",
        stripeCustomerId: "cus_noor",
        currency: "usd",
        amountPerDiverCents: 12000,
        totalCents: 12000,
        customerEmail: null,
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_noor",
      })
      .returning({ id: bookingCheckouts.id });
    if (!checkout) throw new Error("fixture insert failed");
    await db
      .insert(bookingCheckoutBookings)
      .values({ shopId: shop.id, checkoutId: checkout.id, bookingId: booking.id });
    const provider = providerReturning({ status: "deleted" });

    await anonymizeDiver(
      db,
      { shopId: shop.id, personId: diver.id, actorPersonId: owner.id },
      { customerProvider: provider },
    );

    expect(await obligationsFor(db, shop.id)).toEqual([
      "stripe_checkout_session_snapshot:cs_noor",
      "stripe_customer:cus_noor",
    ]);
    expect(provider.deleteCustomer).toHaveBeenCalledWith(
      "acct_test",
      "cus_noor",
      expect.stringContaining(":customer-delete"),
    );
    const [erased] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkout.id));
    expect(erased?.checkoutUrl).toBeNull();
  });
});
