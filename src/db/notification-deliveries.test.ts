import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import {
  isOnceOnlyDeliveryKind,
  type NotificationDeliveryKind,
  ONCE_ONLY_DELIVERY_KINDS,
} from "@/lib/once-only-delivery-kinds";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { latestDeliveryOnly } from "./latest-delivery";
import { listNotificationDeliveryIssues, recordNotificationDelivery } from "./notifications";
import { notificationDeliveries, notificationKind, people, personRoles } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **One `notification_deliveries` row per send** (issue #2728). The attempt
 * trail is the rows; a once-only kind stays one row per booking under a partial
 * unique index, and every "latest status" read takes the newest row. Message
 * data, so these are the adversarial cases first: the double insert, the
 * retry, the superseded failure and the erasure.
 */
const ctx = fileScopedShopContext();

async function seededBooking(email = "nora@example.com") {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email,
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  return { db, shop, trip, bookingId: booking.bookingId, personId: booking.personId };
}

async function rowsFor(db: AppDb, bookingId: string, kind: NotificationDeliveryKind) {
  return db
    .select()
    .from(notificationDeliveries)
    .where(
      and(eq(notificationDeliveries.bookingId, bookingId), eq(notificationDeliveries.kind, kind)),
    )
    .orderBy(notificationDeliveries.attemptedAt);
}

async function latestFor(db: AppDb, bookingId: string, kind: NotificationDeliveryKind) {
  return db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.bookingId, bookingId),
        eq(notificationDeliveries.kind, kind),
        latestDeliveryOnly(db),
      ),
    );
}

describe("the once-only kinds", () => {
  it("are exactly the kinds the migrated partial unique index covers", async () => {
    const { db } = ctx;
    const result = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where tablename = 'notification_deliveries' and indexname = 'notification_deliveries_once_only_unique'`,
    );
    const [index] = result.rows;
    if (!index) throw new Error("the once-only index is missing from the migrated schema");
    expect(index.indexdef).toContain("UNIQUE");
    expect(index.indexdef).toContain("(booking_id, kind)");
    const covered = [...index.indexdef.matchAll(/'([a-z0-9_]+)'::notification_kind/g)].map(
      (match) => match[1],
    );
    expect(covered.sort()).toEqual([...ONCE_ONLY_DELIVERY_KINDS].sort());
  });

  it("are real kinds, and leave the resendable ones out", () => {
    for (const kind of ONCE_ONLY_DELIVERY_KINDS) {
      expect(notificationKind.enumValues).toContain(kind);
    }
    expect(isOnceOnlyDeliveryKind("waiver_request")).toBe(false);
    expect(isOnceOnlyDeliveryKind("trip_rescheduled")).toBe(false);
    expect(isOnceOnlyDeliveryKind("trip_reminder_24h")).toBe(true);
  });

  it("left no attempt-trail table and no whole (booking, kind) unique index behind", async () => {
    const { db } = ctx;
    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_name = 'notification_delivery_attempts'`,
    );
    expect(tables.rows).toEqual([]);
    const indexes = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where indexname = 'notification_deliveries_booking_kind_unique'`,
    );
    expect(indexes.rows).toEqual([]);
  });

  it("refuse a second row for the same booking at the database, not only in the writer", async () => {
    const { db, shop, bookingId } = await seededBooking();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "trip_reminder_24h",
      delivery: { status: "sent", providerMessageId: "first" },
    });

    // A writer that skipped the conflict target: the index is the last word.
    await expect(
      db.transaction((tx) =>
        tx.insert(notificationDeliveries).values({
          shopId: shop.id,
          bookingId,
          kind: "trip_reminder_24h",
          status: "sent",
          providerMessageId: "second",
          attemptedAt: nowDate(),
        }),
      ),
    ).rejects.toThrow();
    expect(await rowsFor(db, bookingId, "trip_reminder_24h")).toHaveLength(1);
  });

  it("update the one row on a retry instead of adding a second", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const first = await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "trip_reminder_7d",
      delivery: { status: "failed", errorCode: "throttled", detail: "slow down" },
    });
    advanceClock();
    const retried = await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "trip_reminder_7d",
      delivery: { status: "sent", providerMessageId: "retried" },
    });

    const rows = await rowsFor(db, bookingId, "trip_reminder_7d");
    expect(rows).toHaveLength(1);
    expect(retried?.id).toBe(first?.id);
    // The failure's prose does not ride along onto the success.
    expect(rows[0]).toMatchObject({
      status: "sent",
      providerMessageId: "retried",
      sendErrorCode: null,
      sendError: null,
    });
    expect(rows[0]?.attemptedAt.getTime()).toBeGreaterThan(first?.attemptedAt.getTime() ?? 0);
  });

  /**
   * Issue #3705: the row is the only proof a message reached the diver, so a
   * failed resend of a sent once-only kind never downgrades it.
   */
  it("keep a sent row, and its provider message id, when a resend fails", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const sent = await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "booking_confirmation",
      delivery: { status: "sent", providerMessageId: "first-message" },
    });
    advanceClock();
    const failedResend = await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "booking_confirmation",
      delivery: { status: "failed", errorCode: "throttled", detail: "slow down" },
    });

    const rows = await rowsFor(db, bookingId, "booking_confirmation");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "sent",
      providerMessageId: "first-message",
      sendErrorCode: null,
    });
    // The caller still gets a row (null means "no such booking"), the kept one.
    expect(failedResend?.id).toBe(sent?.id);
    expect(failedResend?.status).toBe("sent");
  });

  it("still let a sent resend replace a sent row, and a failure replace a failure", async () => {
    const { db, shop, bookingId } = await seededBooking();
    for (const delivery of [
      { status: "failed", errorCode: "a" },
      { status: "failed", errorCode: "b" },
    ] as const) {
      await recordNotificationDelivery(db, {
        shopId: shop.id,
        bookingId,
        kind: "booking_confirmation",
        delivery,
      });
      advanceClock();
    }
    expect((await rowsFor(db, bookingId, "booking_confirmation"))[0]).toMatchObject({
      status: "failed",
      sendErrorCode: "b",
    });
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "booking_confirmation",
      delivery: { status: "sent", providerMessageId: "m1" },
    });
    advanceClock();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "booking_confirmation",
      delivery: { status: "sent", providerMessageId: "m2" },
    });
    expect((await rowsFor(db, bookingId, "booking_confirmation"))[0]).toMatchObject({
      status: "sent",
      providerMessageId: "m2",
    });
  });

  it("let a superseded row sit beside the live one, and never read it as the latest", async () => {
    const { db, shop, bookingId } = await seededBooking();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "trip_reminder_24h",
      delivery: { status: "sent", providerMessageId: "old-date" },
    });
    await db
      .update(notificationDeliveries)
      .set({ supersededAt: nowDate() })
      .where(eq(notificationDeliveries.bookingId, bookingId));
    advanceClock();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "trip_reminder_24h",
      delivery: { status: "sent", providerMessageId: "new-date" },
    });

    const rows = await rowsFor(db, bookingId, "trip_reminder_24h");
    expect(rows.map((row) => row.providerMessageId)).toEqual(["old-date", "new-date"]);
    const latest = await latestFor(db, bookingId, "trip_reminder_24h");
    expect(latest.map((row) => row.providerMessageId)).toEqual(["new-date"]);
    // A second live row is still refused.
    await expect(
      db.transaction((tx) =>
        tx.insert(notificationDeliveries).values({
          shopId: shop.id,
          bookingId,
          kind: "trip_reminder_24h",
          status: "sent",
          attemptedAt: nowDate(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("do not let a superseded failure read as an open delivery issue", async () => {
    const { db, shop, bookingId } = await seededBooking();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "trip_reminder_7d",
      delivery: { status: "failed", errorCode: "bounced" },
    });
    await db
      .update(notificationDeliveries)
      .set({ supersededAt: nowDate() })
      .where(eq(notificationDeliveries.bookingId, bookingId));
    expect(await latestFor(db, bookingId, "trip_reminder_7d")).toEqual([]);
  });

  it("are still one row each per booking: two bookings do not collide", async () => {
    const one = await seededBooking("one@example.com");
    const two = await seededBooking("two@example.com");
    for (const { db, shop, bookingId } of [one, two]) {
      await recordNotificationDelivery(db, {
        shopId: shop.id,
        bookingId,
        kind: "trip_recap",
        delivery: { status: "sent", providerMessageId: bookingId },
      });
    }
    expect(await rowsFor(one.db, one.bookingId, "trip_recap")).toHaveLength(1);
    expect(await rowsFor(two.db, two.bookingId, "trip_recap")).toHaveLength(1);
  });
});

describe("a resendable kind", () => {
  it("keeps one row per send, and the latest read returns the newer one", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const older = await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "waiver_request",
      delivery: { status: "sent", providerMessageId: "first-link" },
    });
    advanceClock();
    const newer = await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "waiver_request",
      delivery: { status: "sent", providerMessageId: "second-link" },
    });

    const rows = await rowsFor(db, bookingId, "waiver_request");
    expect(rows.map((row) => row.providerMessageId)).toEqual(["first-link", "second-link"]);
    const latest = await latestFor(db, bookingId, "waiver_request");
    expect(latest.map((row) => row.id)).toEqual([newer?.id]);
    expect(latest.map((row) => row.id)).not.toContain(older?.id);
  });

  it("orders by when the send was attempted, not by when the row was written", async () => {
    const { db, shop, bookingId } = await seededBooking();
    // Written second, attempted first: a late write of an earlier send must
    // not become "the latest".
    const [attemptedLater] = await db
      .insert(notificationDeliveries)
      .values({
        shopId: shop.id,
        bookingId,
        kind: "trip_rescheduled",
        status: "sent",
        attemptedAt: new Date("2026-08-02T10:00:00.000Z"),
      })
      .returning();
    advanceClock();
    await db.insert(notificationDeliveries).values({
      shopId: shop.id,
      bookingId,
      kind: "trip_rescheduled",
      status: "failed",
      attemptedAt: new Date("2026-08-01T10:00:00.000Z"),
    });

    const latest = await latestFor(db, bookingId, "trip_rescheduled");
    expect(latest.map((row) => row.id)).toEqual([attemptedLater?.id]);
  });

  it("names exactly one latest row when two sends share an instant", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const at = new Date("2026-08-01T10:00:00.000Z");
    await db.insert(notificationDeliveries).values([
      { shopId: shop.id, bookingId, kind: "readiness_link", status: "sent", attemptedAt: at },
      { shopId: shop.id, bookingId, kind: "readiness_link", status: "failed", attemptedAt: at },
    ]);
    expect(await latestFor(db, bookingId, "readiness_link")).toHaveLength(1);
  });
});

describe("Today's failed-delivery row", () => {
  it("clears when a later send of the same message succeeded", async () => {
    const { db, shop, bookingId } = await seededBooking();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "waiver_request",
      delivery: { status: "failed", detail: "mailbox unavailable" },
    });
    expect(
      (await listNotificationDeliveryIssues(db, shop.id)).filter(
        (issue) => issue.booking.id === bookingId,
      ),
    ).toHaveLength(1);

    advanceClock();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "waiver_request",
      delivery: { status: "sent", providerMessageId: "made-it" },
    });

    // The failure is still on file as history, and no longer an issue.
    expect(await rowsFor(db, bookingId, "waiver_request")).toHaveLength(2);
    expect(
      (await listNotificationDeliveryIssues(db, shop.id)).filter(
        (issue) => issue.booking.id === bookingId,
      ),
    ).toEqual([]);
  });

  it("shows one row for a message that failed twice, the newest failure", async () => {
    const { db, shop, bookingId } = await seededBooking();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "trip_rescheduled",
      delivery: { status: "failed", detail: "first" },
    });
    advanceClock();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "trip_rescheduled",
      delivery: { status: "failed", detail: "second" },
    });

    const issues = (await listNotificationDeliveryIssues(db, shop.id)).filter(
      (issue) => issue.booking.id === bookingId,
    );
    expect(issues.map((issue) => issue.delivery.sendError)).toEqual(["second"]);
  });

  it("returns when a later send failed after an earlier success", async () => {
    const { db, shop, bookingId } = await seededBooking();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "readiness_link",
      delivery: { status: "sent", providerMessageId: "went" },
    });
    advanceClock();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "readiness_link",
      delivery: { status: "failed", detail: "did not" },
    });

    const issues = (await listNotificationDeliveryIssues(db, shop.id)).filter(
      (issue) => issue.booking.id === bookingId,
    );
    expect(issues.map((issue) => issue.delivery.sendError)).toEqual(["did not"]);
  });
});

describe("erasure", () => {
  it("scrubs the quoted address from every send's row, not only the latest", async () => {
    const { db, shop, bookingId, personId } = await seededBooking("gone@example.com");
    for (const detail of ["bounce for gone@example.com", "again gone@example.com"]) {
      await recordNotificationDelivery(db, {
        shopId: shop.id,
        bookingId,
        kind: "waiver_request",
        delivery: { status: "failed", errorCode: "bounced", detail },
      });
      advanceClock();
    }
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "booking_confirmation",
      delivery: { status: "failed", detail: "rejected gone@example.com" },
    });
    await db
      .update(notificationDeliveries)
      .set({ providerDetail: "550 gone@example.com: no such user" })
      .where(eq(notificationDeliveries.bookingId, bookingId));

    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const erased = await anonymizeDiver(db, { shopId: shop.id, personId, actorPersonId: owner.id });
    expect(erased.ok).toBe(true);

    const rows = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, bookingId));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({ providerDetail: null, sendError: null });
    }
  });
});
