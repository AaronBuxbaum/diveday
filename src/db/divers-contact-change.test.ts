import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { prepareContactImport } from "@/test/import-fixture";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { commitContactImport } from "@/test/words-wiring";
import { issueBookingCapability, verifyBookingCapability } from "./booking-capabilities";
import { createBooking } from "./bookings";
import { mergeDiverRecords } from "./diver-merge";
import { createDiver, editDiver } from "./divers";
import { upcomingTripsWithCounts } from "./trips";
import { getWaiverForToken } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";

/**
 * **A corrected address takes the old links with it** (#3902). A delivered
 * booking link went to the email or phone on file; when staff change that
 * contact (a typo fixed), whoever holds the old address must not keep a live
 * link. The next send mints a fresh one to the new address. A link the
 * browser was handed (undelivered) is not about the address and stays.
 */
const ctx = fileScopedShopContext();

async function seatedDiver(suffix: string) {
  const { db, shop } = ctx;
  const diver = await createDiver(db, {
    shopId: shop.id,
    fullName: `Contact Change ${suffix}`,
    email: `contact-change-${suffix}@example.com`,
    phone: "+1 305 555 0170",
  });
  if (!diver) throw new Error("diver insert failed");
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (candidate) => !candidate.course && candidate.capacity > candidate.booked,
  );
  if (!trip) throw new Error("open trip missing");
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    personId: diver.id,
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  const delivered = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: booking.bookingId,
    purpose: "readiness",
    delivered: true,
  });
  const handed = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: booking.bookingId,
    purpose: "readiness",
  });
  if (!delivered || !handed) throw new Error("links missing");
  const waiver = await issueWaiverRequest(db, {
    shopId: shop.id,
    bookingId: booking.bookingId,
    now: nowDate(),
  });
  if (!waiver.ok) throw new Error(`waiver issue failed: ${waiver.reason}`);
  return {
    db,
    shop,
    diver,
    bookingId: booking.bookingId,
    delivered: delivered.token,
    handed: handed.token,
    waiver: waiver.token,
  };
}

const live = (token: string) =>
  verifyBookingCapability(ctx.db, { token, purpose: "readiness" }).then(Boolean);

describe("changing a diver's contact revokes their delivered links (#3902)", () => {
  it("revokes on an email change", async () => {
    const { db, shop, diver, delivered, handed } = await seatedDiver("email");
    const result = await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: diver.fullName,
      email: "contact-change-fixed@example.com",
      phone: "+1 305 555 0170",
    });
    expect(result.ok).toBe(true);
    expect(await live(delivered)).toBe(false);
    expect(await live(handed)).toBe(true);
  });

  it("revokes on a phone change", async () => {
    const { db, shop, diver, delivered, handed } = await seatedDiver("phone");
    const result = await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: diver.fullName,
      email: `contact-change-phone@example.com`,
      phone: "+1 305 555 0171",
    });
    expect(result.ok).toBe(true);
    expect(await live(delivered)).toBe(false);
    expect(await live(handed)).toBe(true);
  });

  it("keeps the links when the save leaves both unchanged, however they were typed", async () => {
    const { db, shop, diver, delivered } = await seatedDiver("same");
    const result = await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: "Renamed Only",
      email: "  Contact-Change-Same@Example.com ",
      phone: "305.555.0170",
    });
    expect(result.ok).toBe(true);
    expect(await live(delivered)).toBe(true);
  });

  it("supersedes the unsigned waiver sent to the old address, so a re-send is a new link", async () => {
    const { db, shop, diver, bookingId, waiver } = await seatedDiver("waiver");
    expect((await getWaiverForToken(db, waiver)).state).toBe("available");
    const result = await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: diver.fullName,
      email: "contact-change-waiver-fixed@example.com",
      phone: "+1 305 555 0170",
    });
    expect(result.ok).toBe(true);
    expect((await getWaiverForToken(db, waiver)).state).toBe("unavailable");
    const again = await issueWaiverRequest(db, { shopId: shop.id, bookingId, now: nowDate() });
    if (!again.ok) throw new Error(`re-send failed: ${again.reason}`);
    expect(again.token).not.toBe(waiver);
    expect((await getWaiverForToken(db, again.token)).state).toBe("available");
  });

  it("keeps the unsigned waiver when the save leaves the contact alone", async () => {
    const { db, shop, diver, waiver } = await seatedDiver("waiver-same");
    await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: "Renamed Waiver Diver",
      email: diver.email ?? "",
      phone: "+1 305 555 0170",
    });
    expect((await getWaiverForToken(db, waiver)).state).toBe("available");
  });
});

describe("other writes that change a diver's contact revoke the same links (#3902)", () => {
  it("a merge that takes the other record's email", async () => {
    const { db, shop, diver, delivered, waiver } = await seatedDiver("merge-survivor");
    const source = await createDiver(db, {
      shopId: shop.id,
      fullName: diver.fullName,
      email: "contact-change-merge-source@example.com",
    });
    if (!source) throw new Error("source insert failed");
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const result = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: diver.id,
      actorPersonId: owner,
      choices: { email: "source" },
    });
    expect(result.ok).toBe(true);
    expect(await live(delivered)).toBe(false);
    expect((await getWaiverForToken(db, waiver)).state).toBe("unavailable");
  });

  it("a contacts import that overwrites the phone", async () => {
    const { db, shop, diver, delivered, waiver } = await seatedDiver("import");
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const csv = `full_name,email,phone\n${diver.fullName},${diver.email},+1 305 555 0179\n`;
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), owner);
    expect(summary.peopleUpdated).toBe(1);
    expect(await live(delivered)).toBe(false);
    expect((await getWaiverForToken(db, waiver)).state).toBe("unavailable");
  });

  it("a contacts import that carries the same phone leaves the links alone", async () => {
    const { db, shop, diver, delivered } = await seatedDiver("import-same");
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const csv = `full_name,email,phone\n${diver.fullName},${diver.email},+1 305 555 0170\n`;
    await commitContactImport(db, shop.id, prepareContactImport(csv), owner);
    expect(await live(delivered)).toBe(true);
  });
});
