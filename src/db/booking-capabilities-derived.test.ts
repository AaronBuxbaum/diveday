// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, getTableColumns, isNull } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { capabilityExpiryFor } from "@/lib/booking-capabilities";
import { bookingLinkKeyring, bookingLinkToken, encodeCapabilityId } from "@/lib/booking-link-token";
import { DAY_MS, HOUR_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { countingShopContext } from "@/test/query-count";
import {
  consumeBookingCapability,
  hasLiveDeliveredReadinessLink,
  issueBookingCapability,
  liveBookingLink,
  lockBookingCapabilityForToken,
  resolveRevokedBookingCapability,
  staleBookingCapabilityForToken,
  staleReadinessBookingForResend,
  verifyBookingCapability,
  verifyStrandedBookingCapability,
} from "./booking-capabilities";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { bookingCapabilities, bookings, people, shops, trips } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **Booking links computed from their row** (issue #2711, ADR
 * 20261104-derived-booking-link-tokens): get-or-create, expiry that follows
 * the trip, rotation, the one token door, and the row's fixed identity.
 */

const fileCtx = fileScopedShopContext();

async function seatFor(db: AppDb, shopId: string, email = "nora@example.com") {
  const upcoming = await upcomingTripsWithCounts(db, shopId);
  const trip = upcoming.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!trip) throw new Error("expected seeded trip");
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email,
  });
  if (!outcome.ok) throw new Error("expected booking");
  return { bookingId: outcome.bookingId, trip };
}

async function liveRows(db: AppDb, bookingId: string) {
  return db
    .select({
      id: bookingCapabilities.id,
      purpose: bookingCapabilities.purpose,
      delivered: bookingCapabilities.delivered,
      expiresAt: bookingCapabilities.expiresAt,
      keyVersion: bookingCapabilities.keyVersion,
    })
    .from(bookingCapabilities)
    .where(
      and(eq(bookingCapabilities.bookingId, bookingId), isNull(bookingCapabilities.revokedAt)),
    );
}

/** A real row id with a tag nobody signed. */
function forgedFor(token: string): string {
  return `${token.slice(0, 26)}${randomBytes(32).toString("base64url")}`;
}

const savedEnv = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  BOOKING_LINK_SECRET: process.env.BOOKING_LINK_SECRET,
  BOOKING_LINK_SECRET_PREVIOUS: process.env.BOOKING_LINK_SECRET_PREVIOUS,
};
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("a link lives only in its row", () => {
  // #2711 derived every booking link from its row; the stored hash and the
  // sealed copy are retired and dropped (#3901; the database side is
  // `retired-token-columns.test.ts`).
  it("declares no stored token hash and no sealed token", () => {
    const columns = Object.values(getTableColumns(bookingCapabilities)).map((c) => c.name);
    expect(columns).not.toContain("token_hash");
    expect(columns).not.toContain("token_sealed");
  });
});

describe("issuing is get-or-create", () => {
  it("hands back the same token for the same booking, purpose and audience, from one row", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    const first = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    const again = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    expect(first?.token).toMatch(/^c1\./);
    expect(again?.token).toBe(first?.token);
    expect(await liveRows(db, bookingId)).toHaveLength(1);
  });

  it("keeps the browser's link and the email's link apart: two rows, two tokens", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    // One after the other, never side by side: the executor is one transaction.
    const links = async () => [
      await issueBookingCapability(db, { shopId: shop.id, bookingId, purpose: "readiness" }),
      await issueBookingCapability(db, {
        shopId: shop.id,
        bookingId,
        purpose: "readiness",
        delivered: true,
      }),
    ];
    const [redirect, mailed] = await links();
    expect(redirect?.token).not.toBe(mailed?.token);
    expect(
      await verifyBookingCapability(db, { token: redirect?.token ?? "", purpose: "readiness" }),
    ).toMatchObject({ delivered: false });
    expect(
      await verifyBookingCapability(db, { token: mailed?.token ?? "", purpose: "readiness" }),
    ).toMatchObject({ delivered: true });
    expect(await links()).toEqual([redirect, mailed]);
  });

  it("moves a reused row's expiry with a rescheduled trip, and keeps the link", async () => {
    const { db, shop } = fileCtx;
    const { bookingId, trip } = await seatFor(db, shop.id);
    const now = nowDate();
    const first = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
      delivered: true,
      now,
    });
    const later = new Date(trip.endsAt.getTime() + 90 * DAY_MS);
    await db
      .update(trips)
      .set({ startsAt: new Date(trip.startsAt.getTime() + 90 * DAY_MS), endsAt: later })
      .where(eq(trips.id, trip.id));
    const moved = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
      delivered: true,
      now,
    });
    expect(moved?.token).toBe(first?.token);
    expect(moved?.expiresAt).toEqual(capabilityExpiryFor(later, now));
    const [row] = await liveRows(db, bookingId);
    expect(row?.expiresAt).toEqual(capabilityExpiryFor(later, now));
  });

  it("rotates a row with under a day left: a new token, and the old one revoked", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    const first = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "confirm",
    });
    if (!first) throw new Error("expected a link");
    const nearEnd = new Date(first.expiresAt.getTime() - 12 * HOUR_MS);
    const rotated = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "confirm",
      now: nearEnd,
    });
    expect(rotated?.token).not.toBe(first.token);
    expect(rotated?.expiresAt.getTime()).toBeGreaterThanOrEqual(nearEnd.getTime() + DAY_MS);
    expect(
      await verifyBookingCapability(db, { token: first.token, purpose: "confirm", now: nearEnd }),
    ).toBeNull();
    expect(await liveRows(db, bookingId)).toHaveLength(1);
  });

  it("never reuses a handoff: each issue mints anew and revokes the last", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    const now = nowDate();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const issue = () =>
      issueBookingCapability(db, {
        shopId: shop.id,
        bookingId,
        purpose: "handoff",
        now,
        expiresAt,
      });
    const first = await issue();
    const second = await issue();
    expect(second?.token).not.toBe(first?.token);
    expect(
      await verifyBookingCapability(db, { token: first?.token ?? "", purpose: "handoff", now }),
    ).toBeNull();
    expect(
      await verifyBookingCapability(db, { token: second?.token ?? "", purpose: "handoff", now }),
    ).not.toBeNull();
  });

  it("two issues at once for one booking hand out one token", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    const [a, b] = await Promise.all([
      issueBookingCapability(db, { shopId: shop.id, bookingId, purpose: "claim" }),
      issueBookingCapability(db, { shopId: shop.id, bookingId, purpose: "claim" }),
    ]);
    expect(a?.token).toBe(b?.token);
    expect(await liveRows(db, bookingId)).toHaveLength(1);
  });
});

describe("the page reads the live link and never mints", () => {
  it("returns the live undelivered row's link, and null once it is revoked", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    const read = () =>
      liveBookingLink(db, { shopId: shop.id, bookingId, purpose: "readiness", delivered: false });
    expect(await read()).toBeNull();
    expect(await liveRows(db, bookingId)).toHaveLength(0);
    const redirect = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    expect(await read()).toBe(redirect?.token);
    await db
      .update(bookingCapabilities)
      .set({ revokedAt: nowDate() })
      .where(
        and(eq(bookingCapabilities.bookingId, bookingId), eq(bookingCapabilities.delivered, false)),
      );
    expect(await read()).toBeNull();
    expect(await liveRows(db, bookingId)).toHaveLength(0);
  });

  it("answers the rescue's guard from the delivered row only", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    await issueBookingCapability(db, { shopId: shop.id, bookingId, purpose: "readiness" });
    expect(await hasLiveDeliveredReadinessLink(db, { shopId: shop.id, bookingId })).toBe(false);
    await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
      delivered: true,
    });
    expect(await hasLiveDeliveredReadinessLink(db, { shopId: shop.id, bookingId })).toBe(true);
  });
});

describe("key versions", () => {
  it("replaces a v1 row on the next send once BOOKING_LINK_SECRET is set; the old link verifies until then", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    const v1 = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    process.env.BOOKING_LINK_SECRET = `v2:${"s".repeat(40)}`;
    expect(
      await verifyBookingCapability(db, { token: v1?.token ?? "", purpose: "readiness" }),
    ).not.toBeNull();
    const again = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    // Never re-armed: the send in hand carries a v2 link and the v1 row is revoked.
    expect(again?.token).toMatch(/^c2\./);
    expect((await liveRows(db, bookingId)).map((row) => row.keyVersion)).toEqual([2]);
    expect(
      await verifyBookingCapability(db, { token: v1?.token ?? "", purpose: "readiness" }),
    ).toBeNull();
    const fresh = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "confirm",
    });
    expect(fresh?.token).toMatch(/^c2\./);
    expect(
      await verifyBookingCapability(db, { token: fresh?.token ?? "", purpose: "confirm" }),
    ).not.toBeNull();
  });

  it("rotates a row whose key this deployment no longer holds", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    const v1 = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    process.env.AUTH_SECRET = "";
    process.env.BOOKING_LINK_SECRET = `v2:${"s".repeat(40)}`;
    expect(
      await verifyBookingCapability(db, { token: v1?.token ?? "", purpose: "readiness" }),
    ).toBeNull();
    const rotated = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    expect(rotated?.token).toMatch(/^c2\./);
    const rows = await liveRows(db, bookingId);
    expect(rows.map((row) => row.keyVersion)).toEqual([2]);
  });

  it("refuses a token whose version is not its row's, even with a valid tag", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    const v1 = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    const [row] = await liveRows(db, bookingId);
    if (!row || !v1) throw new Error("expected a row");
    process.env.BOOKING_LINK_SECRET = `v2:${"s".repeat(40)}`;
    const relabelled = bookingLinkToken(
      { id: row.id, keyVersion: 2, purpose: "readiness" },
      bookingLinkKeyring(process.env),
    );
    expect(
      await verifyBookingCapability(db, { token: relabelled, purpose: "readiness" }),
    ).toBeNull();
    expect(
      await verifyBookingCapability(db, { token: v1.token, purpose: "readiness" }),
    ).not.toBeNull();
  });

  it("refuses to issue at all under a malformed BOOKING_LINK_SECRET", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    process.env.BOOKING_LINK_SECRET = "too-short";
    await expect(
      db.transaction((tx) =>
        issueBookingCapability(tx, { shopId: shop.id, bookingId, purpose: "readiness" }),
      ),
    ).rejects.toThrow();
  });
});

describe("one token door", () => {
  it("refuses a real id under a forged tag in every resolver, before any query", async () => {
    const { db, shop, uncounted, count, reset } = await countingShopContext();
    const { bookingId } = await seatFor(uncounted, shop.id);
    const readiness = await issueBookingCapability(uncounted, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    if (!readiness) throw new Error("expected a link");
    const forged = forgedFor(readiness.token);
    reset();
    expect(await verifyBookingCapability(db, { token: forged, purpose: "readiness" })).toBeNull();
    expect(await verifyStrandedBookingCapability(db, { token: forged })).toBeNull();
    expect(
      await resolveRevokedBookingCapability(db, { token: forged, purpose: "readiness" }),
    ).toBeNull();
    expect(
      await staleBookingCapabilityForToken(db, { token: forged, purpose: "readiness" }),
    ).toBeNull();
    expect(await staleReadinessBookingForResend(db, forged)).toBeNull();
    await consumeBookingCapability(db, { shopId: shop.id, token: forged, purpose: "readiness" });
    expect(
      await lockBookingCapabilityForToken(db, {
        shopId: shop.id,
        bookingId,
        token: forged,
        purposes: ["readiness", "course_forms"],
      }),
    ).toBe(false);
    // The genuine token under the wrong purpose is refused the same way.
    expect(
      await verifyBookingCapability(db, { token: readiness.token, purpose: "confirm" }),
    ).toBeNull();
    expect(count()).toBe(0);
    // And the genuine token does reach the database.
    expect(
      await verifyBookingCapability(db, { token: readiness.token, purpose: "readiness" }),
    ).not.toBeNull();
    expect(count()).toBeGreaterThan(0);
  });

  it("refuses a well-formed token for an id that has no row", async () => {
    const { db } = fileCtx;
    const token = bookingLinkToken({ id: randomUUID(), keyVersion: 1, purpose: "readiness" });
    expect(await verifyBookingCapability(db, { token, purpose: "readiness" })).toBeNull();
    expect(token.slice(3, 25)).toHaveLength(encodeCapabilityId(randomUUID()).length);
  });

  it("refuses the link of a merged person", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    const { bookingId: survivorBooking } = await seatFor(db, shop.id, "nora.two@example.com");
    const [loser, survivor] = await Promise.all(
      [bookingId, survivorBooking].map(async (id) => {
        const [row] = await db
          .select({ personId: bookings.personId })
          .from(bookings)
          .where(eq(bookings.id, id));
        return row?.personId ?? "";
      }),
    );
    await db
      .update(people)
      .set({
        mergedIntoPersonId: survivor,
        mergedAt: nowDate(),
        mergedByPersonId: survivor,
        deletedAt: nowDate(),
      })
      .where(eq(people.id, loser ?? ""));
    expect(
      await verifyBookingCapability(db, { token: issued?.token ?? "", purpose: "readiness" }),
    ).toBeNull();
  });
});

describe("a row's identity never changes", () => {
  it.each([
    ["delivered", { delivered: true }],
    ["purpose", { purpose: "confirm" as const }],
    ["key_version", { keyVersion: 2 }],
    ["booking_id", { bookingId: "OTHER" }],
    ["shop_id", { shopId: "OTHER_SHOP" }],
  ])("refuses an update of %s, and allows revoking and moving expiry", async (_column, change) => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    const { bookingId: otherBooking } = await seatFor(db, shop.id, "other@example.com");
    await issueBookingCapability(db, { shopId: shop.id, bookingId, purpose: "readiness" });
    const [row] = await liveRows(db, bookingId);
    if (!row) throw new Error("expected a row");
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Elsewhere", slug: `elsewhere-${randomUUID().slice(0, 8)}`, timezone: "UTC" })
      .returning({ id: shops.id });
    const set = Object.fromEntries(
      Object.entries(change).map(([key, value]) => [
        key,
        value === "OTHER" ? otherBooking : value === "OTHER_SHOP" ? otherShop?.id : value,
      ]),
    );
    await expect(
      db.transaction((tx) =>
        tx.update(bookingCapabilities).set(set).where(eq(bookingCapabilities.id, row.id)),
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/immutable/) } });
    await db
      .update(bookingCapabilities)
      .set({ expiresAt: new Date(row.expiresAt.getTime() + DAY_MS), revokedAt: nowDate() })
      .where(eq(bookingCapabilities.id, row.id));
  });

  it("refuses to un-revoke a row: a dead link stays dead", async () => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    await issueBookingCapability(db, { shopId: shop.id, bookingId, purpose: "readiness" });
    const [row] = await liveRows(db, bookingId);
    if (!row) throw new Error("expected a row");
    await db
      .update(bookingCapabilities)
      .set({ revokedAt: nowDate() })
      .where(eq(bookingCapabilities.bookingId, bookingId));
    await expect(
      db.transaction((tx) =>
        tx
          .update(bookingCapabilities)
          .set({ revokedAt: null })
          .where(eq(bookingCapabilities.bookingId, bookingId)),
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/un-revoked/) } });
  });
});

describe("what a row must carry", () => {
  it.each([
    ["a link row with no key version", { keyVersion: null }],
    ["a key version past 9", { keyVersion: 10 }],
    [
      "a receipt with a key version",
      { purpose: "returning_diver_receipt" as const, keyVersion: 1 },
    ],
  ])("refuses %s", async (_label, change) => {
    const { db, shop } = fileCtx;
    const { bookingId } = await seatFor(db, shop.id);
    const [source] = await db
      .insert(bookingCapabilities)
      .values({
        shopId: shop.id,
        bookingId,
        purpose: "readiness",
        keyVersion: 1,
        expiresAt: new Date(nowDate().getTime() + DAY_MS * 3),
      })
      .returning({ id: bookingCapabilities.id });
    const receipt = "purpose" in change;
    await expect(
      db.transaction((tx) =>
        tx.insert(bookingCapabilities).values({
          shopId: shop.id,
          bookingId,
          purpose: "confirm",
          expiresAt: new Date(nowDate().getTime() + DAY_MS * 3),
          ...(receipt ? { sourceCapabilityId: source?.id } : {}),
          ...change,
        }),
      ),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/booking_capabilities_key_version/) },
    });
  });
});
