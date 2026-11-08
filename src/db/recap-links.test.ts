import { describe, expect, it } from "vitest";
import { signRecapToken } from "@/lib/recap-links";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "../features/anonymize/store";
import { createDiver, editDiver } from "../features/divers/store";
import { shopStaffer } from "../test/substrate-fixtures/db/waivers-test-fixtures";
import { createBooking } from "./bookings";
import { openRecapLink, recapTokenFor } from "./recap-links";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **A corrected contact takes the recap link with it** (issue #3982, option A).
 * The recap link is a signed booking id that lives 180 days; it carries the
 * booking's recap epoch, and a contact change bumps the epoch of every one of
 * the person's bookings, so a link mailed to the old address opens nothing.
 */
const ctx = fileScopedShopContext();

async function bookedDiver(suffix: string) {
  const { db, shop } = ctx;
  const diver = await createDiver(db, {
    shopId: shop.id,
    fullName: `Recap Epoch ${suffix}`,
    email: `recap-epoch-${suffix}@example.com`,
    phone: "+1 305 555 0171",
  });
  if (!diver) throw new Error("diver insert failed");
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (candidate) => !candidate.course && candidate.capacity > candidate.booked,
  );
  if (!trip) throw new Error("open trip missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    personId: diver.id,
  });
  if (!booked.ok) throw new Error(`booking failed: ${booked.reason}`);
  return { db, shop, diver, bookingId: booked.bookingId };
}

const fix = (diver: { id: string; fullName: string }, change: { email: string; phone: string }) =>
  editDiver(ctx.db, {
    shopId: ctx.shop.id,
    personId: diver.id,
    fullName: diver.fullName,
    ...change,
  });

describe("the recap link's epoch", () => {
  it("opens its booking while the contact it went to is still on file", async () => {
    const { db, bookingId } = await bookedDiver("opens");
    const token = await recapTokenFor(db, bookingId);
    if (!token) throw new Error("no recap token");
    expect(await openRecapLink(db, token)).toBe(bookingId);
  });

  it("opens nothing once the email is corrected, and a fresh link opens", async () => {
    const { db, diver, bookingId } = await bookedDiver("email");
    const old = await recapTokenFor(db, bookingId);
    if (!old) throw new Error("no recap token");
    expect(
      (await fix(diver, { email: "recap-epoch-fixed@example.com", phone: "+1 305 555 0171" })).ok,
    ).toBe(true);
    expect(await openRecapLink(db, old)).toBeNull();
    const fresh = await recapTokenFor(db, bookingId);
    if (!fresh) throw new Error("no fresh token");
    expect(fresh).not.toBe(old);
    expect(await openRecapLink(db, fresh)).toBe(bookingId);
  });

  it("opens nothing once the phone alone is corrected", async () => {
    const { db, diver, bookingId } = await bookedDiver("phone");
    const old = await recapTokenFor(db, bookingId);
    if (!old) throw new Error("no recap token");
    await fix(diver, { email: "recap-epoch-phone@example.com", phone: "+1 305 555 0199" });
    expect(await openRecapLink(db, old)).toBeNull();
  });

  it("keeps the link when an edit leaves the contact as it was", async () => {
    const { db, diver, bookingId } = await bookedDiver("unchanged");
    const token = await recapTokenFor(db, bookingId);
    if (!token) throw new Error("no recap token");
    await fix(diver, { email: "recap-epoch-unchanged@example.com", phone: "+1 305 555 0171" });
    expect(await openRecapLink(db, token)).toBe(bookingId);
  });

  it("refuses a link signed for an epoch the booking has not reached, or another's", async () => {
    const { db, bookingId } = await bookedDiver("forged");
    expect(await openRecapLink(db, signRecapToken(bookingId, 1))).toBeNull();
    expect(await openRecapLink(db, signRecapToken(bookingId, -1))).toBeNull();
    expect(await openRecapLink(db, signRecapToken(crypto.randomUUID(), 0))).toBeNull();
    expect(await openRecapLink(db, "not-a-token")).toBeNull();
  });

  it("leaves another diver's link alone", async () => {
    const one = await bookedDiver("one");
    const two = await bookedDiver("two");
    const kept = await recapTokenFor(one.db, two.bookingId);
    if (!kept) throw new Error("no recap token");
    await fix(one.diver, { email: "recap-epoch-one-fixed@example.com", phone: "+1 305 555 0171" });
    expect(await openRecapLink(two.db, kept)).toBe(two.bookingId);
  });

  it("opens nothing once the diver is erased", async () => {
    const { db, shop, diver, bookingId } = await bookedDiver("erased");
    const token = await recapTokenFor(db, bookingId);
    if (!token) throw new Error("no recap token");
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: await shopStaffer(db, shop.id),
    });
    expect(erased).toMatchObject({ ok: true });
    expect(await openRecapLink(db, token)).toBeNull();
  });
});
