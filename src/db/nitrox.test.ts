// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBooking } from "./bookings";
import type { AppDb } from "./client";
import {
  createNitroxCertification,
  reviewNitroxCertification,
  setBookingNitrox,
  verifiedNitroxPersonIds,
} from "./nitrox";
import { bookings, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("open trip missing");
  const booking = await createBooking(db, {
    shopId: shop.id,
    tripId: open.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
  if (!booking.ok) throw new Error("setup booking failed");
  const [diver] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.email, "nora@example.com")))
    .limit(1);
  if (!diver) throw new Error("diver missing");
  return {
    db,
    shopId: shop.id,
    tripId: open.id,
    bookingId: booking.bookingId,
    personId: diver.id,
  };
}

async function certifyDiver(db: AppDb, shopId: string, personId: string) {
  const cert = await createNitroxCertification(db, {
    shopId,
    personId,
    agency: "padi",
    identifier: "NX-1",
  });
  if (!cert) throw new Error("cert insert failed");
  await reviewNitroxCertification(db, { shopId, certificationId: cert.id, status: "verified" });
  return cert;
}

async function wantsNitrox(db: AppDb, bookingId: string) {
  const [row] = await db
    .select({ wantsNitrox: bookings.wantsNitrox })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row?.wantsNitrox;
}

describe("nitrox certification workflow", () => {
  it("captures pending, and only a reviewed card becomes a gate", async () => {
    const { db, shopId, personId } = await context();
    const cert = await createNitroxCertification(db, {
      shopId,
      personId,
      agency: "padi",
      identifier: " NX-42 ",
    });
    if (!cert) throw new Error("cert insert failed");
    expect(cert.status).toBe("pending");
    expect(cert.identifier).toBe("NX-42"); // trimmed
    expect([...(await verifiedNitroxPersonIds(db, shopId))]).not.toContain(personId);

    await reviewNitroxCertification(db, { shopId, certificationId: cert.id, status: "verified" });
    expect([...(await verifiedNitroxPersonIds(db, shopId))]).toContain(personId);
  });
});

describe("setBookingNitrox", () => {
  it("accepts a request from a diver with a verified card", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    const outcome = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    expect(outcome).toEqual({ ok: true, wantsNitrox: true });
    expect(await wantsNitrox(ctx.db, ctx.bookingId)).toBe(true);
  });

  it("refuses a request from a diver with no nitrox card at all", async () => {
    const ctx = await context();
    const outcome = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    expect(outcome).toEqual({ ok: false, reason: "diver_not_certified" });
    expect(await wantsNitrox(ctx.db, ctx.bookingId)).toBe(false);
  });

  it("refuses a request while the card is still pending review", async () => {
    const ctx = await context();
    const cert = await createNitroxCertification(ctx.db, {
      shopId: ctx.shopId,
      personId: ctx.personId,
      agency: "padi",
      identifier: "NX-PENDING",
    });
    if (!cert) throw new Error("cert insert failed");
    const outcome = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    expect(outcome).toEqual({ ok: false, reason: "diver_not_certified" });
  });

  it("refuses a request after the card is rejected", async () => {
    const ctx = await context();
    const cert = await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    await reviewNitroxCertification(ctx.db, {
      shopId: ctx.shopId,
      certificationId: cert.id,
      status: "rejected",
    });
    const outcome = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    expect(outcome).toEqual({ ok: false, reason: "diver_not_certified" });
  });

  it("always lets a request be cleared, card or no card", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    const cleared = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: false,
    });
    expect(cleared).toEqual({ ok: true, wantsNitrox: false });
    expect(await wantsNitrox(ctx.db, ctx.bookingId)).toBe(false);
  });

  it("refuses to write through another shop's id", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    const outcome = await setBookingNitrox(ctx.db, {
      shopId: crypto.randomUUID(),
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    expect(outcome).toEqual({ ok: false, reason: "booking_unavailable" });
    expect(await wantsNitrox(ctx.db, ctx.bookingId)).toBe(false);
  });

  it("refuses a request on a cancelled booking", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    await cancelBooking(ctx.db, ctx.shopId, ctx.bookingId);
    const outcome = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    expect(outcome).toEqual({ ok: false, reason: "booking_unavailable" });
  });
});
