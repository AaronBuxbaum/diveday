import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { cancelBooking, createBooking } from "./bookings";
import type { AppDb } from "./client";
import {
  createNitroxCertification,
  deleteNitroxCertification,
  restoreNitroxCertification,
  reviewNitroxCertification,
  setBookingNitrox,
  unreviewNitroxCertification,
  verifiedNitroxPersonIds,
} from "./nitrox";
import { bookings, nitroxCertifications, people } from "./schema";
import { setShopRentalItems } from "./shops";
import { upcomingTripsWithCounts } from "./trips";
import { getTripPrep } from "./trips-prep";

async function context() {
  const { db, shop } = fileCtx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("open trip missing");
  const booking = await createBooking(db, {
    actor: "staff",
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

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const fileCtx = fileScopedShopContext();

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

  it("counts a request in the prep tanks only after its card is reviewed", async () => {
    const { db, shopId, tripId, bookingId, personId } = await context();
    const shop = fileCtx.shop;
    const before = await getTripPrep(db, shop, tripId);
    if (!before) throw new Error("prep missing");

    expect(await setBookingNitrox(db, { shopId, bookingId, wantsNitrox: true })).toMatchObject({
      ok: true,
      wantsNitrox: true,
      certified: false,
    });
    const card = await createNitroxCertification(db, {
      shopId,
      personId,
      agency: "padi",
      identifier: "NX-PREP-TRANSITION",
    });
    if (!card) throw new Error("card missing");
    const pending = await getTripPrep(db, shop, tripId);
    if (!pending) throw new Error("pending prep missing");
    expect(pending.checklist.nitroxBlockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ bookingId })]),
    );
    expect(pending.checklist.diveCount).toBeGreaterThan(0);
    expect(pending.checklist.tanks.nitrox).toBe(before.checklist.tanks.nitrox);
    expect(pending.checklist.tanks.air).toBe(before.checklist.tanks.air);

    expect(
      await reviewNitroxCertification(db, { shopId, certificationId: card.id, status: "verified" }),
    ).toMatchObject({ ok: true });
    const reviewed = await getTripPrep(db, shop, tripId);
    if (!reviewed) throw new Error("reviewed prep missing");
    expect(reviewed.checklist.nitroxBlockers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ bookingId })]),
    );
    expect(reviewed.checklist.tanks.nitrox).toBe(
      before.checklist.tanks.nitrox + reviewed.checklist.diveCount,
    );
    expect(reviewed.checklist.tanks.air).toBe(
      before.checklist.tanks.air - reviewed.checklist.diveCount,
    );
  });

  it("does not authorize a fill from an imported nitrox card until it's confirmed here", async () => {
    // An imported nitrox card lands `verified` (so it never blocks boarding) but
    // flagged imported with reviewedAt null: the fill waits for the one-tap
    // confirm (ADR 20260724-import-verified-cards, dive-domain-expert carve-out).
    const { db, shopId, bookingId, personId } = await context();
    const [card] = await db
      .insert(nitroxCertifications)
      .values({
        shopId,
        personId,
        agency: "padi",
        identifier: "NX-IMPORTED",
        status: "verified",
        importedAt: new Date("2026-07-01T00:00:00Z"),
        importedFromLabel: "Reef Runners",
      })
      .returning();

    // Verified, but imported-and-unconfirmed → does NOT authorize a fill.
    expect([...(await verifiedNitroxPersonIds(db, shopId))]).not.toContain(personId);
    const beforeConfirm = await setBookingNitrox(db, { shopId, bookingId, wantsNitrox: true });
    expect(beforeConfirm).toMatchObject({ ok: true, wantsNitrox: true, certified: false });

    // The confirm stamps reviewedAt on one tap → now the fill is authorized.
    // The card-sighting attestation that used to guard this tap is gone
    // (ADR 20260814-one-tap-imported-card-confirm); what still stands between a
    // spreadsheet cell and an enriched-air fill is that a staffer confirms this
    // card, by hand, before any of it counts.
    const confirmed = await reviewNitroxCertification(db, {
      shopId,
      certificationId: card.id,
      status: "verified",
    });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.certification.reviewNote).toBeNull();
    }
    expect([...(await verifiedNitroxPersonIds(db, shopId))]).toContain(personId);
    const afterConfirm = await setBookingNitrox(db, { shopId, bookingId, wantsNitrox: true });
    expect(afterConfirm).toMatchObject({ ok: true, certified: true });
  });

  it("refuses a card whose identifier only differs by case from a live one (CR-009)", async () => {
    const { db, shopId, personId } = await context();
    const cert = await createNitroxCertification(db, {
      shopId,
      personId,
      agency: "padi",
      identifier: "nx1234",
    });
    expect(cert).not.toBeNull();
    const duplicate = await createNitroxCertification(db, {
      shopId,
      personId,
      agency: "padi",
      identifier: "NX1234",
    });
    expect(duplicate).toBeNull();
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
    expect(outcome).toEqual({ ok: true, wantsNitrox: true, certified: true });
    expect(await wantsNitrox(ctx.db, ctx.bookingId)).toBe(true);
  });

  it("records but flags a request from a diver with no nitrox card at all", async () => {
    const ctx = await context();
    const outcome = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    // The request is kept so the shop is flagged, but marked uncertified — the
    // fill gate downstream still holds the tank at air until a card is verified.
    expect(outcome).toEqual({ ok: true, wantsNitrox: true, certified: false });
    expect(await wantsNitrox(ctx.db, ctx.bookingId)).toBe(true);
    expect([...(await verifiedNitroxPersonIds(ctx.db, ctx.shopId))]).not.toContain(ctx.personId);
  });

  it("flags a request while the card is still pending review", async () => {
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
    expect(outcome).toEqual({ ok: true, wantsNitrox: true, certified: false });
  });

  it("flags a request after the card is archived", async () => {
    const ctx = await context();
    const cert = await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    await deleteNitroxCertification(ctx.db, {
      shopId: ctx.shopId,
      certificationId: cert.id,
    });
    const outcome = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    expect(outcome).toEqual({ ok: true, wantsNitrox: true, certified: false });
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
    expect(cleared).toEqual({ ok: true, wantsNitrox: false, certified: true });
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

  it("refuses a request on a canceled booking", async () => {
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

  it("archiving the card drops the fill gate, so an existing request fails closed", async () => {
    const ctx = await context();
    const cert = await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    expect(await wantsNitrox(ctx.db, ctx.bookingId)).toBe(true);
    expect(await verifiedNitroxPersonIds(ctx.db, ctx.shopId)).toContain(ctx.personId);

    expect(
      await deleteNitroxCertification(ctx.db, {
        shopId: ctx.shopId,
        certificationId: cert.id,
      }),
    ).toBe(true);
    // The gate reads the card live: with it archived the diver is no longer certified.
    expect(await verifiedNitroxPersonIds(ctx.db, ctx.shopId)).not.toContain(ctx.personId);
  });

  it("restores an archived nitrox card so the gate reads it again", async () => {
    const ctx = await context();
    const cert = await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    expect(
      await deleteNitroxCertification(ctx.db, { shopId: ctx.shopId, certificationId: cert.id }),
    ).toBe(true);
    expect(await verifiedNitroxPersonIds(ctx.db, ctx.shopId)).not.toContain(ctx.personId);

    expect(
      await restoreNitroxCertification(ctx.db, { shopId: ctx.shopId, certificationId: cert.id }),
    ).toBe(true);
    expect(await verifiedNitroxPersonIds(ctx.db, ctx.shopId)).toContain(ctx.personId);
    // A cross-shop restore is refused.
    expect(
      await restoreNitroxCertification(ctx.db, {
        shopId: crypto.randomUUID(),
        certificationId: cert.id,
      }),
    ).toBe(false);
  });

  it("refuses to archive a card through another shop's id", async () => {
    const ctx = await context();
    const cert = await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    expect(
      await deleteNitroxCertification(ctx.db, {
        shopId: crypto.randomUUID(),
        certificationId: cert.id,
      }),
    ).toBe(false);
    expect(await verifiedNitroxPersonIds(ctx.db, ctx.shopId)).toContain(ctx.personId);
  });

  it("refuses to turn on a request when the shop's catalog doesn't offer nitrox", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    // The seeded shop offers nitrox by default; drop it from the catalog to
    // exercise the "most shops don't fill nitrox" case.
    await setShopRentalItems(ctx.db, ctx.shopId, ["bcd", "regulator"]);
    const outcome = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    // Downgraded to false, same shape as a plain clear — never a fill, however
    // verified the diver's card is, when the shop doesn't fill nitrox at all.
    expect(outcome).toEqual({ ok: true, wantsNitrox: false, certified: true });
    expect(await wantsNitrox(ctx.db, ctx.bookingId)).toBe(false);
  });

  it("still lets a request through once the shop adds nitrox to its catalog", async () => {
    const ctx = await context();
    await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    await setShopRentalItems(ctx.db, ctx.shopId, ["bcd"]);
    await setShopRentalItems(ctx.db, ctx.shopId, ["bcd", "nitrox"]);
    const outcome = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    expect(outcome).toEqual({ ok: true, wantsNitrox: true, certified: true });
  });
});

/**
 * **Undoing a nitrox card's review** (`unreviewNitroxCertification`). The
 * fill gate reads the card live, so an undo has to take the diver back out of
 * it: a request already on the booking stays recorded and reads as flagged
 * again, exactly as it did before anyone looked at the card.
 */
describe("unreviewNitroxCertification", () => {
  async function card(db: AppDb, id: string) {
    const [row] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, id));
    if (!row) throw new Error("card vanished");
    return row;
  }

  it("takes the diver out of the fill gate and flags their standing request again", async () => {
    const ctx = await context();
    const cert = await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    const before = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    expect(before).toMatchObject({ ok: true, certified: true });

    expect(
      await unreviewNitroxCertification(ctx.db, {
        shopId: ctx.shopId,
        certificationId: cert.id,
        reviewedAt: (await card(ctx.db, cert.id)).reviewedAt ?? new Date(0),
      }),
    ).toEqual({ ok: true });

    expect(await card(ctx.db, cert.id)).toMatchObject({
      status: "pending",
      reviewedAt: null,
      reviewedByPersonId: null,
    });
    expect(await verifiedNitroxPersonIds(ctx.db, ctx.shopId)).not.toContain(ctx.personId);
    // The request is still on the booking, and now reads as uncertified.
    expect(await wantsNitrox(ctx.db, ctx.bookingId)).toBe(true);
    const after = await setBookingNitrox(ctx.db, {
      shopId: ctx.shopId,
      bookingId: ctx.bookingId,
      wantsNitrox: true,
    });
    expect(after).toMatchObject({ ok: true, wantsNitrox: true, certified: false });
  });

  it("returns an imported card to imported-and-unconfirmed, which authorizes no fill", async () => {
    const ctx = await context();
    const [imported] = await ctx.db
      .insert(nitroxCertifications)
      .values({
        shopId: ctx.shopId,
        personId: ctx.personId,
        agency: "padi",
        identifier: "NX-IMPORTED-UNDO",
        status: "verified",
        importedAt: new Date("2026-07-01T00:00:00Z"),
        importedFromLabel: "Reef Runners",
      })
      .returning();
    if (!imported) throw new Error("card insert failed");
    await reviewNitroxCertification(ctx.db, {
      shopId: ctx.shopId,
      certificationId: imported.id,
      status: "verified",
    });
    expect(await verifiedNitroxPersonIds(ctx.db, ctx.shopId)).toContain(ctx.personId);

    expect(
      await unreviewNitroxCertification(ctx.db, {
        shopId: ctx.shopId,
        certificationId: imported.id,
        reviewedAt: (await card(ctx.db, imported.id)).reviewedAt ?? new Date(0),
      }),
    ).toEqual({ ok: true });

    expect(await card(ctx.db, imported.id)).toMatchObject({ status: "verified", reviewedAt: null });
    expect(await verifiedNitroxPersonIds(ctx.db, ctx.shopId)).not.toContain(ctx.personId);
  });

  it("answers not_found through another shop's id, and the card keeps its review", async () => {
    const ctx = await context();
    const cert = await certifyDiver(ctx.db, ctx.shopId, ctx.personId);

    expect(
      await unreviewNitroxCertification(ctx.db, {
        shopId: crypto.randomUUID(),
        certificationId: cert.id,
        reviewedAt: (await card(ctx.db, cert.id)).reviewedAt ?? new Date(0),
      }),
    ).toEqual({ ok: false, reason: "not_found" });

    const row = await card(ctx.db, cert.id);
    expect(row.status).toBe("verified");
    expect(row.reviewedAt).not.toBeNull();
    expect(await verifiedNitroxPersonIds(ctx.db, ctx.shopId)).toContain(ctx.personId);
  });

  it("refuses a card staff sighted at the counter, and a card nobody reviewed", async () => {
    const ctx = await context();
    const sighted = await certifyDiver(ctx.db, ctx.shopId, ctx.personId);
    await ctx.db
      .update(nitroxCertifications)
      .set({ selfDeclaredAt: new Date("2026-07-01T00:00:00Z") })
      .where(eq(nitroxCertifications.id, sighted.id));
    expect(
      await unreviewNitroxCertification(ctx.db, {
        shopId: ctx.shopId,
        certificationId: sighted.id,
        reviewedAt: (await card(ctx.db, sighted.id)).reviewedAt ?? new Date(0),
      }),
    ).toEqual({ ok: false, reason: "sighted_card" });
    expect((await card(ctx.db, sighted.id)).reviewedAt).not.toBeNull();

    const unreviewed = await createNitroxCertification(ctx.db, {
      shopId: ctx.shopId,
      personId: ctx.personId,
      agency: "ssi",
      identifier: "NX-NEW",
    });
    if (!unreviewed) throw new Error("cert insert failed");
    expect(
      await unreviewNitroxCertification(ctx.db, {
        shopId: ctx.shopId,
        certificationId: unreviewed.id,
        reviewedAt: (await card(ctx.db, unreviewed.id)).reviewedAt ?? new Date(0),
      }),
    ).toEqual({ ok: false, reason: "not_reviewed" });
  });
});
