import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getBookingPayment, setBookingPayment } from "../../db/payments";
import * as schema from "../../db/schema/index";
import {
  accountSessions,
  activityEvents,
  bookingPaymentEvents,
  notificationDeliveries,
  stripeWebhookEvents,
  tripReadMarks,
  userAccounts,
} from "../../db/schema/index";
import { getTripRoster, upcomingTripsWithCounts } from "../../db/trips";
import { fileScopedShopContext } from "../../test/db";
import { pendingSignInForRetention } from "../../test/retention-pending-sign-in";
import { setupRequestForRetention } from "../../test/retention-setup-request";
import { schemaTableNames } from "../../test/schema-tables";
import { writeBackupDeliveryClaimFixture } from "../../test/substrate-fixtures/db/retention-backup-delivery-claims.test-support";
import {
  OUTSIDE_RETENTION,
  UNCLASSIFIED_HELP,
} from "../../test/substrate-fixtures/db/retention-table-classification.test-support";
import { insertShoreAlertStop } from "../../test/substrate-fixtures/db/shore-alert-test-fixtures";
import { writeTodayReadMark } from "../today-catch-up-retention-fixture/store";
import {
  activityRetentionDays,
  RETENTION_DAYS,
  type RetainedTable,
  UNBOUNDED_BY_DECISION,
} from "./rules";
import { PRUNE_ARMS, pruneExpiredRecords, retentionIdentityMatches } from "./store";
import { walletRegistrationRetentionFixture } from "./wallet-registration.test-support";

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

  it("prunes notification deliveries and activity events on their own windows", async () => {
    const { db, shop, reef, entry } = await retentionContext();
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
    expect(outcomeFor(summary, "notification_deliveries").deleted).toBe(1);
    expect(outcomeFor(summary, "activity_events").deleted).toBe(1);

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

  // H-20260916-far-deletion-promise-reach (issue #1726): booking links age out on the same clock, and the
  // assertion that protects a diver is the narrow one — a row whose
  // `expires_at` is still ahead survives *whatever* its `revoked_at` or its
  // age, because a revoked link can still be inside its life and the dead-link
  // page reads it there.
  it("prunes only long-expired booking links, never one still inside its life", async () => {
    const { db, shop, entry } = await retentionContext();
    const window = RETENTION_DAYS.booking_capabilities;
    const live = new Date(NOW.getTime() + 60 * 60 * 1000);
    // One live row per booking, purpose and audience (issue #2711), so each
    // unrevoked row takes its own purpose; rows are told apart by id.
    type Purpose = "readiness" | "confirm" | "claim";
    const link = (purpose: Purpose, expiresAt: Date, revokedAt: Date | null = null) => ({
      shopId: shop.id,
      bookingId: entry.booking.id,
      purpose,
      keyVersion: 1,
      issuedAt: daysAgo(window * 4),
      expiresAt,
      revokedAt,
    });
    const labelById = new Map<string, string>();
    for (const [label, row] of [
      ["cap-long-dead", link("readiness", daysAgo(window + 1))],
      ["cap-long-dead-revoked", link("readiness", daysAgo(window + 1), daysAgo(window + 30))],
      ["cap-recently-dead", link("confirm", daysAgo(window - 1))],
      ["cap-still-live", link("claim", live)],
      // Revoked long ago, issued long ago, not yet expired: kept. Pruning on
      // `revoked_at` or on age is exactly the mistake this row is here for.
      ["cap-revoked-unexpired", link("readiness", live, daysAgo(window * 2))],
    ] as const) {
      const [inserted] = await db.insert(schema.bookingCapabilities).values(row).returning();
      if (inserted) labelById.set(inserted.id, label);
    }

    const summary = await pruneExpiredRecords(db, { now: NOW });
    // At least ours: the seed may hold links of its own that are long dead.
    expect(outcomeFor(summary, "booking_capabilities").deleted).toBeGreaterThanOrEqual(2);

    const remaining = (await db.select().from(schema.bookingCapabilities))
      .flatMap((row) => labelById.get(row.id) ?? [])
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
    const before = await db.select().from(bookingPaymentEvents);
    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "booking_payment_events").deleted).toBe(0);
    expect(await db.select().from(bookingPaymentEvents)).toHaveLength(before.length);
  });

  // The newest entry is the booking's payment state (issue #2716): pruning it
  // would turn a seat paid years ago into one that sailed owing.
  it("prunes old money entries but never a booking's newest one", async () => {
    const { db, shop, entry } = await retentionContext();
    const long = new Date(NOW.getTime() - 3_000 * 24 * 60 * 60_000);
    const longer = new Date(long.getTime() - 24 * 60 * 60_000);
    const write = (status: "deposit_paid" | "paid", occurredAt: Date) =>
      db
        .insert(bookingPaymentEvents)
        .values({
          shopId: shop.id,
          bookingId: entry.booking.id,
          status,
          currency: "usd",
          operation: "manual_mark",
          occurredAt,
        })
        .returning({ id: bookingPaymentEvents.id });
    const [deposit] = await write("deposit_paid", longer);
    const [paid] = await write("paid", long);
    await pruneExpiredRecords(db, { now: NOW });
    const left = (
      await db
        .select({ id: bookingPaymentEvents.id })
        .from(bookingPaymentEvents)
        .where(eq(bookingPaymentEvents.bookingId, entry.booking.id))
    ).map((row) => row.id);
    expect(left).toEqual([paid?.id]);
    expect(left).not.toContain(deposit?.id);
    expect((await getBookingPayment(db, shop.id, entry.booking.id))?.status).toBe("paid");
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
    // The catch-up strip's window (issues #1202, #1187), a per-code rule inside
    // `activity_events` (#2701): the prune is what enforces the boundary. A
    // check-in is the shop's trail first, desk-flagged or not, and keeps its years.
    const { db, shop, reef, entry } = await retentionContext();
    expect(activityRetentionDays("counter_check_in")).toBe(RETENTION_DAYS.activity_events);
    const stale = daysAgo(activityRetentionDays("desk_gear_changed") + 1);
    const line = { shopId: shop.id, tripId: reef.id, bookingId: entry.booking.id };
    const kept = { ...line, actorPersonId: entry.person.id, params: { diver: "Kept" } };
    const written = await db
      .insert(activityEvents)
      .values([
        { ...line, code: "desk_pickup_set", occurredAt: stale },
        { ...line, code: "desk_gear_changed", occurredAt: daysAgo(1) },
        { ...kept, code: "counter_check_in", occurredAt: stale },
      ])
      .returning({ id: activityEvents.id });
    await db.insert(tripReadMarks).values({
      shopId: shop.id,
      tripId: reef.id,
      personId: entry.person.id,
      lastSeenAt: daysAgo(RETENTION_DAYS.trip_read_marks + 1),
    });

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "activity_events").deleted).toBe(1);
    expect(outcomeFor(summary, "trip_read_marks").deleted).toBe(1);
    const left = await db
      .select({ code: activityEvents.code })
      .from(activityEvents)
      .where(
        inArray(
          activityEvents.id,
          written.map((row) => row.id),
        ),
      );
    expect(left.map((row) => row.code).sort()).toEqual(["counter_check_in", "desk_gear_changed"]);
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
        channel: "sms",
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
    expect(left).toEqual([{ channel: "sms" }]);
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
    const link = { setupRequestId: stale.id, expiresAt: daysAgo(window - 7) };
    await db
      .insert(schema.capabilities)
      .values({ ...link, purpose: "shop_setup", tokenHash: "retention-stale-link" });

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "setup_requests").deleted).toBe(1);
    expect(
      await db
        .select({ id: schema.capabilities.id })
        .from(schema.capabilities)
        .where(eq(schema.capabilities.setupRequestId, stale.id)),
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
  wallet_pass_registrations: walletRegistrationRetentionFixture,
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
  activity_events: async ({ db, shop, people }, at) =>
    idOf(
      await db
        .insert(schema.activityEvents)
        .values({ shopId: shop.id, actorPersonId: people[0], code: token(), occurredAt: at })
        .returning({ id: schema.activityEvents.id }),
    ),
  account_sign_in_challenges: pendingSignInForRetention,
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
  capabilities: async ({ db, shop }, at) =>
    insertShoreAlertStop(db, { shopId: shop.id, tokenHash: token(), issuedAt: at }),
  booking_capabilities: async ({ db, shop, entry }, at, n) =>
    idOf(
      await db
        .insert(schema.bookingCapabilities)
        .values({
          shopId: shop.id,
          bookingId: entry.booking.id,
          purpose: n === 0 ? "readiness" : "confirm",
          keyVersion: 1,
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
        .values({ shopId: shop.id, personId: people[n], weekOf: "2026-01-05", createdAt: at })
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
          channel: n === 0 ? "email" : "sms",
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
    const source = readFileSync("src/features/retention/rules.ts", "utf8");
    expect(
      unarguedUnboundedTables(source, UNBOUNDED_BY_DECISION),
      "a table is unbounded by decision with no paragraph in src/features/retention/rules.ts saying " +
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
