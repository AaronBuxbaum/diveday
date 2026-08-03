// @vitest-environment node
import { and, eq, gt, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CAPABILITY_MAX_TTL_MS, CAPABILITY_MIN_TTL_MS } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import {
  issueBookingCapability,
  MAX_LIVE_CAPABILITIES_PER_PURPOSE,
  resolveRevokedBookingCapability,
  revokeBookingCapabilities,
  verifyBookingCapability,
} from "./booking-capabilities";
import { cancelBooking, createBooking } from "./bookings";
import { bookingCapabilities } from "./schema";
import { setTripStatus, upcomingTripsWithCounts } from "./trips";

async function seededContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  const other = trips.find((t) => t.title.startsWith("Night Dive"));
  if (!open || !other) throw new Error("expected seeded trips missing");
  return { db, shop, open, other };
}

async function bookVisitor(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  tripId: string,
) {
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
  if (!outcome.ok) throw new Error("expected booking to succeed");
  return outcome.bookingId;
}

describe("booking capabilities (in-memory PGlite)", () => {
  it("issues a token that verifies back to the same booking", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    expect(issued).not.toBeNull();
    const ctx = await verifyBookingCapability(db, {
      token: issued?.token ?? "",
      purpose: "readiness",
    });
    expect(ctx).toMatchObject({ bookingId, shopId: shop.id });
  });

  it("rejects a token verified under the wrong purpose", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    const ctx = await verifyBookingCapability(db, {
      token: issued?.token ?? "",
      purpose: "confirm",
    });
    expect(ctx).toBeNull();
  });

  it("rejects an unknown/garbage token", async () => {
    const { db } = await seededContext();
    const ctx = await verifyBookingCapability(db, {
      token: "not-a-real-token",
      purpose: "readiness",
    });
    expect(ctx).toBeNull();
  });

  it("does not leak the booking id in the token", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    expect(issued?.token ?? "").not.toContain(bookingId);
  });

  it("refuses to issue for a booking that belongs to a different shop", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const issued = await issueBookingCapability(db, {
      shopId: "99999999-8888-4777-8666-555555555555",
      bookingId,
      purpose: "readiness",
    });
    expect(issued).toBeNull();
  });

  it("expires: a token past its expiresAt fails to verify", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const now = nowDate();
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
      now,
    });
    const past = new Date(now.getTime() + CAPABILITY_MAX_TTL_MS + 1);
    const ctx = await verifyBookingCapability(db, {
      token: issued?.token ?? "",
      purpose: "readiness",
      now: past,
    });
    expect(ctx).toBeNull();
  });

  it("floors expiry at least a day out even for an imminent trip", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const now = nowDate();
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
      now,
    });
    expect(issued?.expiresAt.getTime() ?? 0).toBeGreaterThanOrEqual(
      now.getTime() + CAPABILITY_MIN_TTL_MS,
    );
  });

  it("revocation: a revoked token stops verifying immediately, before its natural expiry", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    await revokeBookingCapabilities(db, { shopId: shop.id, bookingId, purpose: "readiness" });
    const ctx = await verifyBookingCapability(db, {
      token: issued?.token ?? "",
      purpose: "readiness",
    });
    expect(ctx).toBeNull();
  });

  it("revocation is purpose-scoped: revoking readiness leaves confirm untouched", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const readiness = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    const confirm = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "confirm",
    });
    await revokeBookingCapabilities(db, { shopId: shop.id, bookingId, purpose: "readiness" });
    expect(
      await verifyBookingCapability(db, { token: readiness?.token ?? "", purpose: "readiness" }),
    ).toBeNull();
    expect(
      await verifyBookingCapability(db, { token: confirm?.token ?? "", purpose: "confirm" }),
    ).not.toBeNull();
  });

  it("cancellation: cancelling the booking fails a previously-issued, unexpired token closed", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    await cancelBooking(db, shop.id, bookingId);
    const ctx = await verifyBookingCapability(db, {
      token: issued?.token ?? "",
      purpose: "readiness",
    });
    expect(ctx).toBeNull();
  });

  it("cancellation: cancelling the TRIP (not the booking) also fails a previously-issued token closed (security review finding)", async () => {
    // Trip cancellation doesn't cascade into cancelling its bookings — a
    // separate, pre-existing gap outside CR-002/CR-003's scope — so the
    // booking itself still reads "booked" after the trip is called off. A
    // security review found that without this check, an outstanding
    // confirm/readiness link kept full payment/rental-fit/contact authority
    // for a trip that no longer runs.
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "confirm",
    });
    await setTripStatus(db, shop.id, open.id, "cancelled");
    const ctx = await verifyBookingCapability(db, {
      token: issued?.token ?? "",
      purpose: "confirm",
    });
    expect(ctx).toBeNull();
  });

  it("cancellation: refuses to issue a fresh capability for an already-cancelled booking", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    await cancelBooking(db, shop.id, bookingId);
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    expect(issued).toBeNull();
  });

  it("cross-booking: a valid token for one booking never verifies as another booking's", async () => {
    const { db, shop, open, other } = await seededContext();
    const bookingA = await bookVisitor(db, shop.id, open.id);
    const outcomeB = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: other.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    if (!outcomeB.ok) throw new Error("expected second booking to succeed");
    const bookingB = outcomeB.bookingId;

    const issuedA = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: bookingA,
      purpose: "readiness",
    });
    const ctx = await verifyBookingCapability(db, {
      token: issuedA?.token ?? "",
      purpose: "readiness",
    });
    expect(ctx?.bookingId).toBe(bookingA);
    expect(ctx?.bookingId).not.toBe(bookingB);
  });

  it("replay: does not re-validate a token that was already superseded by revocation", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const first = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "confirm",
    });
    await revokeBookingCapabilities(db, { shopId: shop.id, bookingId, purpose: "confirm" });
    // A replay of the same bearer token after revocation must fail every time, not just once.
    for (let i = 0; i < 3; i++) {
      const ctx = await verifyBookingCapability(db, {
        token: first?.token ?? "",
        purpose: "confirm",
      });
      expect(ctx).toBeNull();
    }
  });

  it("issuing a new capability does not invalidate an earlier still-valid one", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const first = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    const second = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    expect(first?.token).not.toBe(second?.token);
    expect(
      await verifyBookingCapability(db, { token: first?.token ?? "", purpose: "readiness" }),
    ).not.toBeNull();
    expect(
      await verifyBookingCapability(db, { token: second?.token ?? "", purpose: "readiness" }),
    ).not.toBeNull();
  });
});

describe("live-capability cap (security review: unbounded minting on page GETs)", () => {
  /**
   * Tokens are stored only as hashes, so an existing row's plaintext can never
   * be handed back and a page render that needs a link has no choice but to
   * mint one — every GET of the confirmation and signed-waiver pages did. The
   * pile is therefore capped rather than reused. Each mint gets its own
   * increasing `now` so "oldest" is unambiguous rather than a same-millisecond
   * tie.
   */
  async function mintSeries(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    shopId: string,
    bookingId: string,
    count: number,
    start = nowDate(),
  ) {
    const issued: string[] = [];
    for (let i = 0; i < count; i++) {
      const capability = await issueBookingCapability(db, {
        shopId,
        bookingId,
        purpose: "readiness",
        now: new Date(start.getTime() + i * 1000),
      });
      if (!capability) throw new Error("expected capability to be issued");
      issued.push(capability.token);
    }
    return issued;
  }

  async function liveRowCount(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    bookingId: string,
    now: Date,
  ) {
    const rows = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.bookingId, bookingId),
          isNull(bookingCapabilities.revokedAt),
          gt(bookingCapabilities.expiresAt, now),
        ),
      );
    return rows.length;
  }

  it("holds the live set at the cap however many times a page is loaded", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const start = nowDate();
    const overflow = MAX_LIVE_CAPABILITIES_PER_PURPOSE + 7;
    await mintSeries(db, shop.id, bookingId, overflow, start);
    const at = new Date(start.getTime() + overflow * 1000);
    expect(await liveRowCount(db, bookingId, at)).toBe(MAX_LIVE_CAPABILITIES_PER_PURPOSE);
  });

  it("keeps the newest links working — the one the diver is about to follow", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const start = nowDate();
    const overflow = MAX_LIVE_CAPABILITIES_PER_PURPOSE + 3;
    const tokens = await mintSeries(db, shop.id, bookingId, overflow, start);
    const at = new Date(start.getTime() + overflow * 1000);
    for (const token of tokens.slice(-MAX_LIVE_CAPABILITIES_PER_PURPOSE)) {
      expect(
        await verifyBookingCapability(db, { token, purpose: "readiness", now: at }),
      ).toMatchObject({ bookingId });
    }
  });

  it("retires the oldest first, so a long-forwarded link dies before a recent one", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const start = nowDate();
    // Exactly at the cap: nothing retired yet, the very first link still works.
    const tokens = await mintSeries(
      db,
      shop.id,
      bookingId,
      MAX_LIVE_CAPABILITIES_PER_PURPOSE,
      start,
    );
    const oldest = tokens[0] ?? "";
    const atCap = new Date(start.getTime() + MAX_LIVE_CAPABILITIES_PER_PURPOSE * 1000);
    expect(
      await verifyBookingCapability(db, { token: oldest, purpose: "readiness", now: atCap }),
    ).not.toBeNull();

    // One more mint trips the cap, and it is the oldest that goes.
    const [newest] = await mintSeries(db, shop.id, bookingId, 1, atCap);
    const after = new Date(atCap.getTime() + 1000);
    expect(
      await verifyBookingCapability(db, { token: oldest, purpose: "readiness", now: after }),
    ).toBeNull();
    expect(
      await verifyBookingCapability(db, { token: newest ?? "", purpose: "readiness", now: after }),
    ).toMatchObject({ bookingId });
    expect(
      await verifyBookingCapability(db, {
        token: tokens[1] ?? "",
        purpose: "readiness",
        now: after,
      }),
    ).not.toBeNull();
  });

  it("counts each purpose separately — a pile of readiness links never retires a confirm link", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const start = nowDate();
    const confirm = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "confirm",
      now: start,
    });
    const overflow = MAX_LIVE_CAPABILITIES_PER_PURPOSE + 5;
    await mintSeries(db, shop.id, bookingId, overflow, new Date(start.getTime() + 1000));
    const at = new Date(start.getTime() + (overflow + 2) * 1000);
    expect(
      await verifyBookingCapability(db, {
        token: confirm?.token ?? "",
        purpose: "confirm",
        now: at,
      }),
    ).toMatchObject({ bookingId });
  });

  it("cancellation still walks every live row, retired ones included", async () => {
    // Retiring revokes rather than deletes, so `revokeBookingCapabilities`
    // (which filters on `revokedAt IS NULL`) simply leaves an already-retired
    // row alone. What must stay true is that after a cancellation nothing for
    // this booking verifies — cap or no cap.
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const start = nowDate();
    const overflow = MAX_LIVE_CAPABILITIES_PER_PURPOSE + 4;
    const tokens = await mintSeries(db, shop.id, bookingId, overflow, start);
    await cancelBooking(db, shop.id, bookingId);
    const at = new Date(start.getTime() + overflow * 1000);
    for (const token of tokens) {
      expect(
        await verifyBookingCapability(db, { token, purpose: "readiness", now: at }),
      ).toBeNull();
    }
    expect(await liveRowCount(db, bookingId, at)).toBe(0);
  });
});

describe("resolveRevokedBookingCapability (self-cancel confirmation, docs ADR 20260727-diver-self-service-cancel)", () => {
  it("still resolves a token that cancelling the booking just revoked", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    await cancelBooking(db, shop.id, bookingId);
    // The strict check is already dead for this exact case — cancelling
    // revoked the very token being redirected back to.
    expect(
      await verifyBookingCapability(db, { token: issued?.token ?? "", purpose: "readiness" }),
    ).toBeNull();
    expect(
      await resolveRevokedBookingCapability(db, {
        token: issued?.token ?? "",
        purpose: "readiness",
      }),
    ).toEqual({ bookingId });
  });

  it("rejects an unknown/garbage token, same as the strict check", async () => {
    const { db } = await seededContext();
    expect(
      await resolveRevokedBookingCapability(db, {
        token: "not-a-real-token",
        purpose: "readiness",
      }),
    ).toBeNull();
  });

  it("rejects a token past its natural expiry — relaxing revocation isn't relaxing expiry", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const now = nowDate();
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
      now,
    });
    const past = new Date(now.getTime() + CAPABILITY_MAX_TTL_MS + 1);
    expect(
      await resolveRevokedBookingCapability(db, {
        token: issued?.token ?? "",
        purpose: "readiness",
        now: past,
      }),
    ).toBeNull();
  });

  it("still enforces purpose scoping", async () => {
    const { db, shop, open } = await seededContext();
    const bookingId = await bookVisitor(db, shop.id, open.id);
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "confirm",
    });
    await cancelBooking(db, shop.id, bookingId);
    expect(
      await resolveRevokedBookingCapability(db, {
        token: issued?.token ?? "",
        purpose: "readiness",
      }),
    ).toBeNull();
  });
});
