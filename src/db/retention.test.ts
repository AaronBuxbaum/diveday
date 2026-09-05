import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { RETENTION_DAYS } from "@/lib/retention";
import { seededShopContext } from "@/test/db";
import { setBookingPayment } from "./payments";
import { pruneExpiredRecords } from "./retention";
import {
  accountTokens,
  activityEvents,
  bookingPaymentEvents,
  notificationDeliveries,
  notificationDeliveryAttempts,
  stripeWebhookEvents,
  tripDeskEvents,
  tripReadMarks,
  userAccounts,
} from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-03T00:00:00.000Z");

/** `days` before {@link NOW}. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

async function retentionContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [entry] = await getTripRoster(db, shop.id, reef.id);
  if (!entry) throw new Error("demo booking missing");
  const [owner] = await db.select().from(userAccounts).limit(1);
  return { db, shop, reef, entry, owner };
}

function outcomeFor(summary: Awaited<ReturnType<typeof pruneExpiredRecords>>, table: string) {
  const outcome = summary.outcomes.find((row) => row.table === table);
  if (!outcome) throw new Error(`no prune outcome for ${table}`);
  return outcome;
}

describe("pruneExpiredRecords", () => {
  it("deletes stripe webhook events past the window and keeps everything inside it", async () => {
    const { db } = await retentionContext();
    const window = RETENTION_DAYS.stripe_webhook_events;
    await db.insert(stripeWebhookEvents).values([
      {
        id: "evt_ancient",
        type: "account.updated",
        account: "acct_1",
        occurredAt: daysAgo(window + 1),
      },
      // One day inside the window: kept. This is the row whose `occurred_at`
      // `hasNewerAccountUpdate` still needs as chronological evidence.
      {
        id: "evt_recent",
        type: "account.updated",
        account: "acct_1",
        occurredAt: daysAgo(window - 1),
      },
    ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "stripe_webhook_events").deleted).toBe(1);

    const remaining = await db.select({ id: stripeWebhookEvents.id }).from(stripeWebhookEvents);
    expect(remaining.map((row) => row.id)).toEqual(["evt_recent"]);
  });

  it("never prunes a webhook event inside Stripe's own retry window", async () => {
    const { db } = await retentionContext();
    // A failed delivery from three days ago whose claim was released: Stripe is
    // still retrying it, and its row is the evidence a *newer* account.updated
    // is compared against. Pruning it is the fail-open the review named.
    await db.insert(stripeWebhookEvents).values({
      id: "evt_retrying",
      type: "account.updated",
      account: "acct_1",
      occurredAt: daysAgo(3),
      claimedAt: null,
    });
    await pruneExpiredRecords(db, { now: NOW });
    const [row] = await db
      .select()
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.id, "evt_retrying"));
    expect(row).toBeDefined();
  });

  it("prunes notification attempts and activity events on their own windows", async () => {
    const { db, shop, reef, entry } = await retentionContext();
    const attemptsWindow = RETENTION_DAYS.notification_delivery_attempts;
    const seededAttempts = await db
      .select({ id: notificationDeliveryAttempts.id })
      .from(notificationDeliveryAttempts);
    await db.insert(notificationDeliveryAttempts).values([
      {
        shopId: shop.id,
        bookingId: entry.booking.id,
        kind: "booking_confirmation",
        status: "sent",
        attemptedAt: daysAgo(attemptsWindow + 1),
      },
      {
        shopId: shop.id,
        bookingId: entry.booking.id,
        kind: "booking_confirmation",
        status: "sent",
        attemptedAt: daysAgo(attemptsWindow - 1),
      },
    ]);

    const deliveryWindow = RETENTION_DAYS.notification_deliveries;
    const insertedDeliveries = await db
      .insert(notificationDeliveries)
      .values([
        {
          shopId: shop.id,
          bookingId: entry.booking.id,
          kind: "booking_confirmation",
          status: "sent",
          attemptedAt: daysAgo(deliveryWindow + 1),
        },
        {
          shopId: shop.id,
          bookingId: entry.booking.id,
          kind: "waiver_request",
          status: "sent",
          attemptedAt: daysAgo(deliveryWindow - 1),
        },
      ])
      .returning({ id: notificationDeliveries.id });
    const ancientDelivery = insertedDeliveries[0];
    const recentDelivery = insertedDeliveries[1];
    if (!ancientDelivery || !recentDelivery) throw new Error("delivery insert failed");

    const activityWindow = RETENTION_DAYS.activity_events;
    const seededActivity = await db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(eq(activityEvents.shopId, shop.id));
    await db.insert(activityEvents).values([
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: entry.booking.id,
        actorPersonId: entry.person.id,
        message: "ancient",
        occurredAt: daysAgo(activityWindow + 1),
      },
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: entry.booking.id,
        actorPersonId: entry.person.id,
        message: "recent",
        occurredAt: daysAgo(activityWindow - 1),
      },
    ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "notification_delivery_attempts").deleted).toBe(1);
    expect(outcomeFor(summary, "notification_deliveries").deleted).toBe(1);
    expect(outcomeFor(summary, "activity_events").deleted).toBe(1);

    // The seeded attempts (all recent) plus the one recent insert; only the
    // ancient row is gone.
    const attempts = await db
      .select({ id: notificationDeliveryAttempts.id })
      .from(notificationDeliveryAttempts);
    expect(attempts).toHaveLength(seededAttempts.length + 1);
    const deliveries = await db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries);
    expect(deliveries.map((row) => row.id)).toContain(recentDelivery.id);
    expect(deliveries.map((row) => row.id)).not.toContain(ancientDelivery.id);

    const activity = await db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(eq(activityEvents.shopId, shop.id));
    // The seeded rows plus the one recent insert; the ancient one is gone.
    expect(activity).toHaveLength(seededActivity.length + 1);
  });

  // The one arm measured from a column that is not "when it happened". A live
  // credential is never eligible at any age; the window runs from expiry.
  it("prunes only long-expired account tokens, never a live one", async () => {
    const { db, owner } = await retentionContext();
    if (!owner) throw new Error("seeded user account missing");
    const window = RETENTION_DAYS.account_tokens;
    await db.insert(accountTokens).values([
      {
        userAccountId: owner.id,
        purpose: "password_reset",
        tokenHash: "hash-long-dead",
        expiresAt: daysAgo(window + 1),
      },
      {
        userAccountId: owner.id,
        purpose: "password_reset",
        tokenHash: "hash-recently-dead",
        expiresAt: daysAgo(window - 1),
      },
      {
        // Issued a decade ago is impossible, but "very old row, still live" is
        // the shape that must survive: eligibility is expiry, not age.
        userAccountId: owner.id,
        purpose: "email_verification",
        tokenHash: "hash-still-live",
        expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      },
    ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "account_tokens").deleted).toBe(1);
    const remaining = await db.select({ tokenHash: accountTokens.tokenHash }).from(accountTokens);
    expect(remaining.map((row) => row.tokenHash).sort()).toEqual([
      "hash-recently-dead",
      "hash-still-live",
    ]);
  });

  it("leaves a freshly written money trail entirely alone", async () => {
    const { db, shop, entry } = await retentionContext();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "paid",
      currency: "usd",
      amountCents: 18_000,
      operation: "checkout_settled",
    });
    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "booking_payment_events").deleted).toBe(0);
    expect(await db.select().from(bookingPaymentEvents)).toHaveLength(1);
  });

  it("is idempotent: a second pass with nothing eligible deletes nothing", async () => {
    const { db } = await retentionContext();
    await db.insert(stripeWebhookEvents).values({
      id: "evt_ancient",
      type: "invoice.paid",
      account: null,
      occurredAt: daysAgo(RETENTION_DAYS.stripe_webhook_events + 5),
    });
    const first = await pruneExpiredRecords(db, { now: NOW });
    const second = await pruneExpiredRecords(db, { now: NOW });
    expect(first.totalDeleted).toBe(1);
    expect(second.totalDeleted).toBe(0);
    expect(second.failedTables).toEqual([]);
  });

  it("prunes a stale shift handoff and leaves this morning's alone", async () => {
    // The catch-up strip's own window (issues #1202, #1187). Thirty days is the
    // difference between a same-day handoff and the replayable surveillance
    // feed the boundary refuses, so the prune is what enforces the boundary.
    const { db, shop, reef, entry } = await retentionContext();
    const window = RETENTION_DAYS.trip_desk_events;
    await db.insert(tripDeskEvents).values([
      {
        shopId: shop.id,
        tripId: reef.id,
        kind: "arrival",
        bookingId: entry.booking.id,
        subjectPersonId: entry.person.id,
        occurredAt: daysAgo(window + 1),
      },
      {
        shopId: shop.id,
        tripId: reef.id,
        kind: "gear_changed",
        bookingId: entry.booking.id,
        subjectPersonId: entry.person.id,
        occurredAt: daysAgo(1),
      },
    ]);
    await db.insert(tripReadMarks).values({
      shopId: shop.id,
      tripId: reef.id,
      personId: entry.person.id,
      lastSeenSeq: 0,
      lastSeenAt: daysAgo(RETENTION_DAYS.trip_read_marks + 1),
    });

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "trip_desk_events").deleted).toBe(1);
    expect(outcomeFor(summary, "trip_read_marks").deleted).toBe(1);
    const left = await db.select({ kind: tripDeskEvents.kind }).from(tripDeskEvents);
    expect(left).toEqual([{ kind: "gear_changed" }]);
    expect(await db.select().from(tripReadMarks)).toHaveLength(0);
  });

  it("reports a per-table outcome for every retained table, with the window applied", async () => {
    const { db } = await retentionContext();
    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(summary.outcomes.map((row) => row.table).sort()).toEqual(
      Object.keys(RETENTION_DAYS).sort(),
    );
    for (const outcome of summary.outcomes) {
      expect(outcome.retentionDays).toBe(RETENTION_DAYS[outcome.table]);
      expect(outcome.failed).toBe(false);
      expect(outcome.capped).toBe(false);
    }
  });
});
