// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBooking } from "./bookings";
import { type AppDb, createTestDb } from "./client";
import { createGearItem } from "./gear";
import {
  createNitroxCertification,
  listShopTanks,
  listTripNitroxFills,
  logNitroxFill,
  reviewNitroxCertification,
  verifiedNitroxPersonIds,
} from "./nitrox";
import { getShopBySlug, upcomingTripsWithCounts } from "./queries";
import { gearItems, people, personRoles } from "./schema";
import { seedDemo } from "./seed";

async function context() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
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
  // A staff member to log the fill.
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!staff) throw new Error("staff missing");
  const tank = await createGearItem(db, { shopId: shop.id, label: "AL80 #1", type: "tank" });
  if (!tank) throw new Error("tank insert failed");
  return {
    db,
    shopId: shop.id,
    tripId: open.id,
    bookingId: booking.bookingId,
    personId: diver.id,
    staffId: staff.id,
    tankId: tank.id,
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

const base = { oxygenPercent: 32, analyzerSignature: "Nora Quinn" };

describe("nitrox certification workflow", () => {
  it("captures pending and lets a verified card gate a fill", async () => {
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
    expect(await verifiedNitroxPersonIds(db, shopId)).not.toContain(personId);

    await reviewNitroxCertification(db, {
      shopId,
      certificationId: cert.id,
      status: "verified",
    });
    expect([...(await verifiedNitroxPersonIds(db, shopId))]).toContain(personId);
  });
});

describe("logNitroxFill", () => {
  it("logs a fill for a certified diver and derives the MOD", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    const out = await logNitroxFill(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      gearItemId: ctx.tankId,
      filledByPersonId: ctx.staffId,
      ...base,
    });
    expect(out).toEqual({ ok: true, fillId: expect.any(String), maxDepthMeters: 33 });

    const fills = await listTripNitroxFills(ctx.db, ctx.shopId, ctx.tripId);
    expect(fills).toHaveLength(1);
    expect(fills[0]?.fill.oxygenPercent).toBe(32);
    expect(fills[0]?.tank.label).toBe("AL80 #1");
  });

  it("fails closed for a diver without a verified nitrox card", async () => {
    const ctx = await context();
    // No cert at all.
    const out = await logNitroxFill(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      gearItemId: ctx.tankId,
      filledByPersonId: ctx.staffId,
      ...base,
    });
    expect(out).toEqual({ ok: false, reason: "diver_not_certified" });
  });

  it("treats a pending (unverified) card as not certified", async () => {
    const ctx = await context();
    await createNitroxCertification(ctx.db, {
      shopId: ctx.shopId,
      personId: ctx.personId,
      agency: "padi",
      identifier: "NX-P",
    });
    const out = await logNitroxFill(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      gearItemId: ctx.tankId,
      filledByPersonId: ctx.staffId,
      ...base,
    });
    expect(out).toEqual({ ok: false, reason: "diver_not_certified" });
  });

  it("rejects an out-of-band mix", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    const out = await logNitroxFill(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      gearItemId: ctx.tankId,
      filledByPersonId: ctx.staffId,
      oxygenPercent: 45,
      analyzerSignature: "Nora Quinn",
    });
    expect(out).toEqual({ ok: false, reason: "invalid_mix" });
  });

  it("requires the diver's analysis signature", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    const out = await logNitroxFill(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      gearItemId: ctx.tankId,
      filledByPersonId: ctx.staffId,
      oxygenPercent: 32,
      analyzerSignature: "   ",
    });
    expect(out).toEqual({ ok: false, reason: "analysis_required" });
  });

  it("rejects a non-tank gear item", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    const bcd = await createGearItem(ctx.db, {
      shopId: ctx.shopId,
      label: "BCD M #1",
      type: "bcd",
    });
    if (!bcd) throw new Error("bcd insert failed");
    const out = await logNitroxFill(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      gearItemId: bcd.id,
      filledByPersonId: ctx.staffId,
      ...base,
    });
    expect(out).toEqual({ ok: false, reason: "not_a_tank" });
  });

  it("rejects a retired tank", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    await ctx.db.update(gearItems).set({ state: "retired" }).where(eq(gearItems.id, ctx.tankId));
    const out = await logNitroxFill(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      gearItemId: ctx.tankId,
      filledByPersonId: ctx.staffId,
      ...base,
    });
    expect(out).toEqual({ ok: false, reason: "tank_retired" });
  });

  it("rejects a booking from another tenant", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    const out = await logNitroxFill(ctx.db, {
      shopId: "00000000-0000-4000-8000-000000000000",
      bookingId: ctx.bookingId,
      gearItemId: ctx.tankId,
      filledByPersonId: ctx.staffId,
      ...base,
    });
    expect(out).toEqual({ ok: false, reason: "booking_unavailable" });
  });

  it("only offers non-retired tanks", async () => {
    const ctx = await context();
    await ctx.db.update(gearItems).set({ state: "retired" }).where(eq(gearItems.id, ctx.tankId));
    const tanks = await listShopTanks(ctx.db, ctx.shopId);
    expect(tanks.map((t) => t.id)).not.toContain(ctx.tankId);
  });
});
