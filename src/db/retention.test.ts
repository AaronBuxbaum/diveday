import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { RETENTION_DAYS, type RetainedTable, UNBOUNDED_BY_DECISION } from "@/lib/retention";
import { fileScopedShopContext } from "@/test/db";
import {
  accountTokenForRetention,
  pendingSignInForRetention,
} from "@/test/retention-account-tokens";
import { setupRequestForRetention } from "@/test/retention-setup-request";
import { schemaTableNames } from "@/test/schema-tables";
import { setBookingPayment } from "./payments";
import { PRUNE_ARMS, pruneExpiredRecords, retentionIdentityMatches } from "./retention";
import { writeBackupDeliveryClaimFixture } from "./retention-backup-delivery-claims.test-support";
import { OUTSIDE_RETENTION } from "./retention-table-classification.test-support";
import * as schema from "./schema";
import {
  accountSessions,
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
import { insertShoreAlertToken } from "./shore-alert-test-fixtures";
import { writeTodayReadMark } from "./today-catch-up-retention-fixture";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-03T00:00:00.000Z");

/** `days` before {@link NOW}. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

async function retentionContext() {
  const { db, shop } = ctx;
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

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

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
        code: "counter_check_in",
        params: { diver: "Ancient" },
        occurredAt: daysAgo(activityWindow + 1),
      },
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: entry.booking.id,
        actorPersonId: entry.person.id,
        code: "counter_check_in",
        params: { diver: "Recent" },
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

  // A session carries its device's IP address and user agent. It ages out on
  // its own expiry, which every use slides forward, so a session still honoured
  // is never eligible however long ago it was created.
  it("prunes only long-expired sessions, with their IP and user agent, never a live one", async () => {
    const { db, shop, owner } = await retentionContext();
    if (!owner) throw new Error("seeded user account missing");
    const window = RETENTION_DAYS.account_sessions;
    const session = (token: string, expiresAt: Date) => ({
      userAccountId: owner.id,
      personId: owner.personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      roles: ["owner"],
      name: "Retention session",
      token,
      expiresAt,
      ipAddress: "203.0.113.7",
      userAgent: "Retention/1.0",
      createdAt: daysAgo(window * 10),
    });
    await db
      .insert(accountSessions)
      .values([
        session("session-long-dead", daysAgo(window + 1)),
        session("session-recently-dead", daysAgo(window - 1)),
        session("session-still-live", new Date(NOW.getTime() + 60 * 60 * 1000)),
      ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "account_sessions").deleted).toBe(1);
    const remaining = await db
      .select({ token: accountSessions.token })
      .from(accountSessions)
      .where(eq(accountSessions.name, "Retention session"));
    expect(remaining.map((row) => row.token).sort()).toEqual([
      "session-recently-dead",
      "session-still-live",
    ]);
  });

  // H-82 (issue #1726): booking links age out on the same clock, and the
  // assertion that protects a diver is the narrow one — a row whose
  // `expires_at` is still ahead survives *whatever* its `revoked_at` or its
  // age, because a revoked link can still be inside its life and the dead-link
  // page reads it there.
  it("prunes only long-expired booking links, never one still inside its life", async () => {
    const { db, shop, entry } = await retentionContext();
    const window = RETENTION_DAYS.booking_capabilities;
    const live = new Date(NOW.getTime() + 60 * 60 * 1000);
    const link = (tokenHash: string, expiresAt: Date, revokedAt: Date | null = null) => ({
      shopId: shop.id,
      bookingId: entry.booking.id,
      purpose: "readiness" as const,
      tokenHash,
      issuedAt: daysAgo(window * 4),
      expiresAt,
      revokedAt,
    });
    await db.insert(schema.bookingCapabilities).values([
      link("cap-long-dead", daysAgo(window + 1)),
      link("cap-long-dead-revoked", daysAgo(window + 1), daysAgo(window + 30)),
      link("cap-recently-dead", daysAgo(window - 1)),
      link("cap-still-live", live),
      // Revoked long ago, issued long ago, not yet expired: kept. Pruning on
      // `revoked_at` or on age is exactly the mistake this row is here for.
      link("cap-revoked-unexpired", live, daysAgo(window * 2)),
    ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    // At least ours: the seed may hold links of its own that are long dead.
    expect(outcomeFor(summary, "booking_capabilities").deleted).toBeGreaterThanOrEqual(2);

    const mine = new Set([
      "cap-long-dead",
      "cap-long-dead-revoked",
      "cap-recently-dead",
      "cap-still-live",
      "cap-revoked-unexpired",
    ]);
    const remaining = (
      await db
        .select({ tokenHash: schema.bookingCapabilities.tokenHash })
        .from(schema.bookingCapabilities)
    )
      .map((row) => row.tokenHash)
      .filter((hash) => mine.has(hash))
      .sort();
    expect(remaining).toEqual(["cap-recently-dead", "cap-revoked-unexpired", "cap-still-live"]);
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
  it("prunes demo entries past their window and keeps the recent ones", async () => {
    const { db } = await retentionContext();
    await db.insert(schema.demoEntries).values([
      { source: "home-hero", role: "owner", enteredAt: daysAgo(RETENTION_DAYS.demo_entries + 1) },
      { source: "pricing", role: "owner", enteredAt: daysAgo(1) },
    ]);
    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "demo_entries").deleted).toBe(1);
    const left = await db.select({ source: schema.demoEntries.source }).from(schema.demoEntries);
    expect(left).toEqual([{ source: "pricing" }]);
  });

  it("prunes only finished sends past their window, never one the drain could still offer", async () => {
    const { db, shop } = await retentionContext();
    const window = RETENTION_DAYS.notification_send_queue;
    const old = daysAgo(window + 1);
    const row = (key: string, status: "queued" | "processing" | "sent" | "failed", extra = {}) => ({
      shopId: shop.id,
      idempotencyKey: `retention-${key}`,
      status,
      payloadSealed: null as string | null,
      nextAttemptAt: old,
      createdAt: old,
      updatedAt: old,
      ...extra,
    });
    await db.insert(schema.notificationSendQueue).values([
      row("sent-old", "sent"),
      row("failed-old", "failed"),
      row("sent-recent", "sent", { updatedAt: daysAgo(window - 1) }),
      // Work in flight, and a parked row still holding its payload: neither is
      // finished, whatever its age.
      row("queued-old", "queued", { payloadSealed: "sealed" }),
      row("processing-old", "processing", { payloadSealed: "sealed" }),
      row("parked-old", "failed", {
        payloadSealed: "sealed",
        errorCode: "sealed_payload_unreadable",
      }),
    ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "notification_send_queue").deleted).toBe(2);
    const left = await db
      .select({ key: schema.notificationSendQueue.idempotencyKey })
      .from(schema.notificationSendQueue);
    expect(
      left
        .map((r) => r.key)
        .filter((k) => k.startsWith("retention-"))
        .sort(),
    ).toEqual([
      "retention-parked-old",
      "retention-processing-old",
      "retention-queued-old",
      "retention-sent-recent",
    ]);
  });

  it("prunes a waiver link's delivery outcome past its window and keeps the recent one", async () => {
    const { db, shop } = await retentionContext();
    const [record] = await db
      .select({ id: schema.waiverRecords.id })
      .from(schema.waiverRecords)
      .where(eq(schema.waiverRecords.shopId, shop.id))
      .limit(1);
    if (!record) throw new Error("seeded waiver record missing");
    await db
      .delete(schema.waiverDeliveries)
      .where(eq(schema.waiverDeliveries.waiverRecordId, record.id));
    const window = RETENTION_DAYS.waiver_deliveries;
    await db.insert(schema.waiverDeliveries).values([
      {
        shopId: shop.id,
        waiverRecordId: record.id,
        channel: "email",
        status: "failed",
        detail: "Mailbox does not exist",
        attemptedAt: daysAgo(window + 1),
      },
      {
        shopId: shop.id,
        waiverRecordId: record.id,
        channel: "text",
        status: "sent",
        attemptedAt: daysAgo(window - 1),
      },
    ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "waiver_deliveries").deleted).toBe(1);
    const left = await db
      .select({ channel: schema.waiverDeliveries.channel })
      .from(schema.waiverDeliveries)
      .where(eq(schema.waiverDeliveries.waiverRecordId, record.id));
    expect(left).toEqual([{ channel: "text" }]);
  });

  it("prunes a set-up request and receipt metadata past its window, with its setup link, and keeps a recent one", async () => {
    const { db } = await retentionContext();
    const window = RETENTION_DAYS.setup_requests;
    const [stale, fresh] = await db
      .insert(schema.setupRequests)
      .values([
        setupRequestForRetention("Stale Lead", daysAgo(window + 1)),
        setupRequestForRetention("Fresh Lead", daysAgo(1)),
      ])
      .returning({ id: schema.setupRequests.id });
    if (!stale || !fresh) throw new Error("insert failed");
    await db.insert(schema.shopSetupLinks).values({
      tokenHash: "retention-stale-link",
      setupRequestId: stale.id,
      expiresAt: daysAgo(window - 7),
    });

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "setup_requests").deleted).toBe(1);
    expect(
      await db
        .select({ id: schema.shopSetupLinks.id })
        .from(schema.shopSetupLinks)
        .where(eq(schema.shopSetupLinks.setupRequestId, stale.id)),
    ).toEqual([]);
    const left = await db
      .select({ shopName: schema.setupRequests.shopName })
      .from(schema.setupRequests)
      .where(eq(schema.setupRequests.source, "retention-test"));
    expect(left).toEqual([{ shopName: "Fresh Lead" }]);
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

/**
 * The classification proves every table is declared; this proves every
 * window deletes. Each retained table gets a stale and a fresh row on its
 * declared clock, and only the stale row should be taken. The exhaustive
 * fixture map makes a new window fail compilation until it has a fixture.
 */
type Fixture = Awaited<ReturnType<typeof retentionContext>> & {
  waiverRecordId: string;
  people: [string, string];
};
let unique = 0;
const token = () => {
  unique += 1;
  return `retention-${unique}`;
};
const idOf = <T extends { id: string }>([row]: T[]) => {
  if (!row) throw new Error("fixture insert returned nothing");
  return row.id;
};

const STALE_AND_FRESH = {
  stripe_webhook_events: async ({ db }, at) =>
    idOf(
      await db
        .insert(schema.stripeWebhookEvents)
        .values({ id: `evt_${token()}`, type: "charge.refunded", occurredAt: at })
        .returning({ id: schema.stripeWebhookEvents.id }),
    ),
  integration_events: async ({ db, shop }, at) =>
    idOf(
      await db
        .insert(schema.integrationEvents)
        .values({
          shopId: shop.id,
          eventType: "booking.created",
          entityType: "booking",
          entityId: token(),
          idempotencyKey: token(),
          payload: {},
          createdAt: at,
        })
        .returning({ id: schema.integrationEvents.id }),
    ),
  integration_oauth_states: async ({ db, shop, people }, at) =>
    idOf(
      await db
        .insert(schema.integrationOauthStates)
        .values({
          stateHash: token(),
          shopId: shop.id,
          personId: people[0],
          provider: "shopify",
          expiresAt: at,
        })
        .returning({ id: schema.integrationOauthStates.id }),
    ),
  notification_deliveries: async ({ db, shop, entry }, at, n) =>
    idOf(
      await db
        .insert(schema.notificationDeliveries)
        .values({
          shopId: shop.id,
          bookingId: entry.booking.id,
          kind: n === 0 ? "booking_confirmation" : "waiver_request",
          status: "sent",
          attemptedAt: at,
        })
        .returning({ id: schema.notificationDeliveries.id }),
    ),
  notification_delivery_attempts: async ({ db, shop, entry }, at) =>
    idOf(
      await db
        .insert(schema.notificationDeliveryAttempts)
        .values({
          shopId: shop.id,
          bookingId: entry.booking.id,
          kind: "booking_confirmation",
          status: "sent",
          attemptedAt: at,
        })
        .returning({ id: schema.notificationDeliveryAttempts.id }),
    ),
  activity_events: async ({ db, shop, people }, at) =>
    idOf(
      await db
        .insert(schema.activityEvents)
        .values({ shopId: shop.id, actorPersonId: people[0], code: token(), occurredAt: at })
        .returning({ id: schema.activityEvents.id }),
    ),
  account_sign_in_challenges: pendingSignInForRetention,
  account_tokens: accountTokenForRetention,
  account_sessions: async ({ db, shop, owner, people }, at) =>
    idOf(
      await db
        .insert(schema.accountSessions)
        .values({
          userAccountId: owner?.id ?? "",
          token: token(),
          expiresAt: at,
          personId: people[0],
          shopId: shop.id,
          shopSlug: shop.slug,
          roles: [],
          name: "Retention",
        })
        .returning({ id: schema.accountSessions.id }),
    ),
  shop_contact_email_confirmation_tokens: async ({ db, shop }, at) =>
    idOf(
      await db
        .insert(schema.shopContactEmailConfirmationTokens)
        .values({
          shopId: shop.id,
          email: "desk@example.com",
          tokenHash: token(),
          expiresAt: at,
        })
        .returning({ id: schema.shopContactEmailConfirmationTokens.id }),
    ),
  shop_shore_alert_tokens: async ({ db, shop }, at) =>
    insertShoreAlertToken(db, { shopId: shop.id, tokenHash: token(), createdAt: at }),
  booking_capabilities: async ({ db, shop, entry }, at, n) =>
    idOf(
      await db
        .insert(schema.bookingCapabilities)
        .values({
          shopId: shop.id,
          bookingId: entry.booking.id,
          purpose: n === 0 ? "readiness" : "confirm",
          tokenHash: token(),
          expiresAt: at,
        })
        .returning({ id: schema.bookingCapabilities.id }),
    ),
  booking_payment_events: async ({ db, shop, entry }, at) =>
    idOf(
      await db
        .insert(schema.bookingPaymentEvents)
        .values({
          shopId: shop.id,
          bookingId: entry.booking.id,
          status: "paid",
          currency: "usd",
          operation: "manual_mark",
          occurredAt: at,
        })
        .returning({ id: schema.bookingPaymentEvents.id }),
    ),
  push_subscriptions: async ({ db, shop, reef, people }, at) =>
    idOf(
      await db
        .insert(schema.pushSubscriptions)
        .values({
          shopId: shop.id,
          tripId: reef.id,
          personId: people[0],
          endpoint: `https://push.example.com/${token()}`,
          p256dh: "key",
          auth: "auth",
          createdAt: at,
        })
        .returning({ id: schema.pushSubscriptions.id }),
    ),
  trip_desk_events: async ({ db, shop, reef }, at) =>
    idOf(
      await db
        .insert(schema.tripDeskEvents)
        .values({ shopId: shop.id, tripId: reef.id, kind: "arrival", occurredAt: at })
        .returning({ id: schema.tripDeskEvents.id }),
    ),
  trip_read_marks: async ({ db, shop, reef, people }, at, n) =>
    idOf(
      await db
        .insert(schema.tripReadMarks)
        .values({ shopId: shop.id, tripId: reef.id, personId: people[n], lastSeenAt: at })
        .returning({ id: schema.tripReadMarks.id }),
    ),
  today_read_marks: writeTodayReadMark,
  form_drafts: async ({ db, shop, people }, at) =>
    idOf(
      await db
        .insert(schema.formDrafts)
        .values({ shopId: shop.id, personId: people[0], form: token(), fields: {}, savedAt: at })
        .returning({ id: schema.formDrafts.id }),
    ),
  demo_entries: async ({ db }, at) =>
    idOf(
      await db
        .insert(schema.demoEntries)
        .values({ source: token(), role: "owner", enteredAt: at })
        .returning({ id: schema.demoEntries.id }),
    ),
  inbound_messages: async ({ db, shop }, at) =>
    idOf(
      await db
        .insert(schema.inboundMessages)
        .values({
          shopId: shop.id,
          channel: "email",
          fromAddress: "diver@example.com",
          body: "Hello",
          receivedAt: at,
          providerMessageId: token(),
        })
        .returning({ id: schema.inboundMessages.id }),
    ),
  staff_replies: async ({ db, shop, people }, at) =>
    idOf(
      await db
        .insert(schema.staffReplies)
        .values({
          shopId: shop.id,
          personId: people[0],
          channel: "email",
          toAddress: "diver@example.com",
          body: "Hello",
          locale: "en-US",
          status: "sent",
          sentAt: at,
        })
        .returning({ id: schema.staffReplies.id }),
    ),
  claude_usage: async ({ db, shop }, at) =>
    idOf(
      await db
        .insert(schema.claudeUsage)
        .values({
          shopId: shop.id,
          feature: "inbox_sort",
          model: "claude-haiku-5-5",
          outcome: "ok",
          createdAt: at,
        })
        .returning({ id: schema.claudeUsage.id }),
    ),
  claude_call_content: async ({ db, shop }, at) => {
    const usageId = idOf(
      await db
        .insert(schema.claudeUsage)
        .values({
          shopId: shop.id,
          feature: "inbox_sort",
          model: "claude-haiku-5-5",
          outcome: "ok",
        })
        .returning({ id: schema.claudeUsage.id }),
    );
    return idOf(
      await db
        .insert(schema.claudeCallContent)
        .values({ usageId, shopId: shop.id, systemText: "Sort.", contentText: "Hi", createdAt: at })
        .returning({ id: schema.claudeCallContent.id }),
    );
  },
  assist_results: async ({ db, shop }, at, n) =>
    idOf(
      await db
        .insert(schema.assistResults)
        .values({
          shopId: shop.id,
          feature: "review_flags",
          subjectKey: `review-${n}`,
          value: { flags: [] },
          inputDigest: "0",
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: schema.assistResults.id }),
    ),
  website_setup_drafts: async ({ db, shop }, at) =>
    idOf(
      await db
        .insert(schema.websiteSetupDrafts)
        .values({ shopId: shop.id, host: "example.com", lines: [], readAt: at })
        .onConflictDoUpdate({ target: schema.websiteSetupDrafts.shopId, set: { readAt: at } })
        .returning({ id: schema.websiteSetupDrafts.shopId }),
    ),
  weekly_digest_sends: async ({ db, shop, people }, at, n) =>
    idOf(
      await db
        .insert(schema.weeklyDigestSends)
        .values({
          shopId: shop.id,
          personId: people[n],
          weekOf: "2026-01-05",
          unsubscribeTokenHash: token(),
          createdAt: at,
        })
        .returning({ id: schema.weeklyDigestSends.id }),
    ),
  shop_backup_delivery_claims: async ({ db, shop }, at, n) =>
    writeBackupDeliveryClaimFixture(db, shop.id, at, n),
  crew_notices: async ({ db, shop, reef, people }, at) =>
    idOf(
      await db
        .insert(schema.crewNotices)
        .values({
          shopId: shop.id,
          personId: people[0],
          tripId: reef.id,
          change: "assigned",
          createdAt: at,
        })
        .returning({ id: schema.crewNotices.id }),
    ),
  notification_send_queue: async ({ db, shop }, at) =>
    idOf(
      await db
        .insert(schema.notificationSendQueue)
        .values({
          shopId: shop.id,
          idempotencyKey: token(),
          nextAttemptAt: at,
          status: "sent",
          updatedAt: at,
        })
        .returning({ id: schema.notificationSendQueue.id }),
    ),
  waiver_deliveries: async ({ db, shop, waiverRecordId }, at, n) =>
    idOf(
      await db
        .insert(schema.waiverDeliveries)
        .values({
          shopId: shop.id,
          waiverRecordId,
          channel: n === 0 ? "email" : "text",
          status: "sent",
          attemptedAt: at,
        })
        .returning({ id: schema.waiverDeliveries.id }),
    ),
  setup_requests: async ({ db }, at) =>
    idOf(
      await db
        .insert(schema.setupRequests)
        .values({
          shopName: "Retention Divers",
          region: "Florida",
          runsBoat: true,
          currentSystem: "paper",
          contactName: "Ret Ention",
          email: `${token()}@example.com`,
          source: "pricing",
          locale: "en-US",
          createdAt: at,
        })
        .returning({ id: schema.setupRequests.id }),
    ),
  incident_reports: async ({ db, shop, reef, people }, at) =>
    idOf(
      await db
        .insert(schema.incidentReports)
        .values({ shopId: shop.id, tripId: reef.id, createdByPersonId: people[0], occurredAt: at })
        .returning({ id: schema.incidentReports.id }),
    ),
  lost_items: async ({ db, shop, reef }, at) =>
    idOf(
      await db
        .insert(schema.lostItems)
        .values({
          shopId: shop.id,
          tripId: reef.id,
          description: "blue mask",
          status: "returned",
          resolvedAt: at,
        })
        .returning({ id: schema.lostItems.id }),
    ),
  email_bounces: async ({ db, shop }, at) =>
    idOf(
      await db
        .insert(schema.emailBounces)
        .values({
          shopId: shop.id,
          providerMessageId: token(),
          event: "bounce",
          recipient: `${token()}@example.com`,
          bounceType: "Permanent",
          occurredAt: at,
        })
        .returning({ id: schema.emailBounces.id }),
    ),
  departure_notes: async ({ db, shop, reef }, at) =>
    idOf(
      await db
        .insert(schema.departureNotes)
        .values({ shopId: shop.id, tripId: reef.id, body: "Bring a jacket", sentAt: at })
        .returning({ id: schema.departureNotes.id }),
    ),
} satisfies Record<RetainedTable, (fixture: Fixture, at: Date, n: 0 | 1) => Promise<string>>;

describe("every retention window deletes", () => {
  it.each(Object.keys(RETENTION_DAYS) as RetainedTable[])(
    "%s: takes the row past its window and keeps the one inside it",
    async (table) => {
      const base = await retentionContext();
      const { db, shop } = base;
      const [record] = await db
        .select({ id: schema.waiverRecords.id })
        .from(schema.waiverRecords)
        .where(eq(schema.waiverRecords.shopId, shop.id))
        .limit(1);
      const staff = await db
        .select({ id: schema.people.id })
        .from(schema.people)
        .where(eq(schema.people.shopId, shop.id))
        .limit(2);
      if (!record || staff.length < 2) throw new Error("seeded fixtures missing");
      // Clear the seat's own one-per-kind rows so the two written here are the only ones.
      await db
        .delete(schema.waiverDeliveries)
        .where(eq(schema.waiverDeliveries.waiverRecordId, record.id));
      await db
        .delete(schema.notificationDeliveries)
        .where(eq(schema.notificationDeliveries.bookingId, base.entry.booking.id));
      await db
        .delete(schema.bookingCapabilities)
        .where(eq(schema.bookingCapabilities.bookingId, base.entry.booking.id));
      await db.delete(schema.tripReadMarks).where(eq(schema.tripReadMarks.tripId, base.reef.id));
      await db.delete(schema.weeklyDigestSends).where(eq(schema.weeklyDigestSends.shopId, shop.id));
      const fixture: Fixture = {
        ...base,
        waiverRecordId: record.id,
        people: [staff[0]?.id ?? "", staff[1]?.id ?? ""],
      };
      const days = RETENTION_DAYS[table];
      const write = STALE_AND_FRESH[table];
      const stale = await write(fixture, daysAgo(days + 1), 0);
      const fresh = await write(fixture, daysAgo(days - 1), 1);

      await pruneExpiredRecords(db, { now: NOW });

      const arm = PRUNE_ARMS[table];
      const left = await db
        .select({ id: arm.id })
        .from(arm.from)
        .where(retentionIdentityMatches(arm.id, [stale, fresh]));
      expect(left.map((row) => row.id)).toEqual([fresh]);
    },
  );
});
/** What the guard's failure says, so a session reads the rule and not the list. */
const UNCLASSIFIED_HELP =
  "a table in src/db/schema/ that retention classifies as nothing. Give it a window " +
  "in RETENTION_DAYS if it is a trail that should be pruned; add it to " +
  "UNBOUNDED_BY_DECISION *and write the paragraph in src/lib/retention.ts saying who " +
  "decided it is kept forever and when*, the way gear_service_events and " +
  "trip_stage_events do; or add it to OUTSIDE_RETENTION if a clock is the wrong " +
  "instrument for it at all. Adding a bare name to whichever list makes this test go " +
  "green is the one wrong answer";

/**
 * The three classifications, checked against the names a schema actually has.
 *
 * Takes the table names rather than reading the schema, so the failure paths
 * below can hand it a schema that has grown a table or lost one.
 */
function classifyTables(tableNames: readonly string[]) {
  const declared = [...Object.keys(RETENTION_DAYS), ...UNBOUNDED_BY_DECISION, ...OUTSIDE_RETENTION];
  const declaredSet = new Set(declared);
  const present = new Set(tableNames);
  return {
    /** Tables no list classifies: the new-table case this guard exists for. */
    unclassified: tableNames.filter((name) => !declaredSet.has(name)),
    /** Names the schema no longer has: the rename that orphans a window. */
    orphaned: declared.filter((name) => !present.has(name)),
    /** A name in two lists at once, which is two answers to one question. */
    contradictory: declared.filter((name, index) => declared.indexOf(name) !== index),
  };
}

/**
 * Names in `UNBOUNDED_BY_DECISION` that the retention docblock does not argue.
 *
 * "Deliberate" is the whole value of that list, so the cheapest half of it is
 * checked mechanically: the file's leading docblock must carry a paragraph
 * naming the table, and that paragraph must cite the decision — a date, an ADR
 * id, or an issue number. Whether the argument is any good is a reviewer's
 * call; that somebody wrote one is a test's.
 */
function unarguedUnboundedTables(source: string, names: readonly string[]): string[] {
  const docblock = source.slice(0, source.indexOf("*/"));
  // Unwrapped before matching: a paragraph that says "ADR\n * 20260804-…"
  // cites its decision exactly as well as one that fits the id on a line, and
  // a guard that disagreed would be a guard against re-wrapping a comment.
  const paragraphs = docblock
    .split(/\n \*\n/)
    .map((text) => text.replace(/^\s*\*[ \t]?/gm, "").replace(/\s+/g, " "));
  const cites = /\d{4}-\d{2}-\d{2}|ADR \d{8}-|#\d+/;
  return names.filter(
    (name) => !paragraphs.some((text) => text.includes(name) && cites.test(text)),
  );
}

describe("retention classification", () => {
  it("forces every schema table to be pruned, unbounded on purpose, or out of scope", () => {
    const tableNames = schemaTableNames();
    // A floor, not a census: an enumeration that silently stopped finding
    // tables would leave `unclassified` empty and read green. The same reason
    // export.test.ts carries this line, and the same reason it is a low number
    // — the reverse assertion below is what actually notices a table leaving.
    expect(tableNames.length).toBeGreaterThan(20);

    const { unclassified, orphaned, contradictory } = classifyTables(tableNames);
    expect(unclassified, UNCLASSIFIED_HELP).toEqual([]);
    // The half most likely to be skipped, and the one that catches a rename
    // leaving a window pointed at a table that no longer exists.
    expect(orphaned, "a retention list names a table the schema does not have").toEqual([]);
    expect(contradictory, "a table is classified twice, which is two answers").toEqual([]);
  });

  it("refuses a new table that nobody classified", () => {
    const { unclassified, orphaned } = classifyTables([...schemaTableNames(), "diver_mood_events"]);
    expect(unclassified).toEqual(["diver_mood_events"]);
    expect(orphaned).toEqual([]);
  });

  it("refuses a rename that orphans a window", () => {
    const renamed = schemaTableNames().filter((name) => name !== "activity_events");
    expect(classifyTables(renamed).orphaned).toEqual(["activity_events"]);
  });

  it("holds every deliberately unbounded trail to a paragraph that cites its decision", () => {
    const source = readFileSync("src/lib/retention.ts", "utf8");
    expect(
      unarguedUnboundedTables(source, UNBOUNDED_BY_DECISION),
      "a table is unbounded by decision with no paragraph in src/lib/retention.ts saying " +
        "who decided and when",
    ).toEqual([]);
  });

  it("refuses an unbounded trail whose paragraph is missing or cites nothing", () => {
    const source = [
      "/**",
      " * **`argued_events` is deliberately unbounded.** Chosen by the product owner,",
      " * 2026-09-10, over a 30-day window.",
      " *",
      " * **`asserted_events` is deliberately unbounded.** Because it is.",
      " */",
      "export const UNBOUNDED_BY_DECISION = [];",
    ].join("\n");
    expect(
      unarguedUnboundedTables(source, ["argued_events", "asserted_events", "absent_events"]),
    ).toEqual(["asserted_events", "absent_events"]);
  });
});
