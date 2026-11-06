import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { DAY_MS, MINUTE_MS, nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createBookingParty } from "./bookings";
import { issueCapability, mintCapability, verifyCapability } from "./capabilities";
import { mergeDiverRecords } from "./diver-merge";
import { bookings, capabilities, people, personRoles, shops, waiverRecords } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import {
  type CounterWaiverKey,
  claimCounterLink,
  completeWaiver,
  getWaiverForToken,
  recordWaiverDraft,
  waiverLinkDoor,
} from "./waivers-completion";
import {
  clearAnswers,
  issueCounterLink,
  medicalReferralAnswers,
  openOnDevice,
} from "./waivers-test-fixtures";

/**
 * **The counter tablet's waiver link** (`waiver_link`, issue #2743, ADR
 * 20261105-waiver-folds-into-the-thread). Safety-critical and a bearer
 * credential, so adversarial: a token of another purpose, an expired, spent,
 * revoked or other shop's link, a seat that changed hands, a forged key, and
 * what a merge and an erasure do with it, each against a real record.
 */
const ctx = fileScopedShopContext();

async function owner() {
  const { db, shop } = ctx;
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!row) throw new Error("expected the seeded owner");
  return row.id;
}

/** A booked seat on an upcoming trip, its holder, and a counter link for it. */
async function counterSeat(fullName = "Dana Counter") {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("seeded shop has no upcoming trip");
  const slug = `${fullName.toLowerCase().replace(/\W+/g, ".")}.${crypto.randomUUID().slice(0, 6)}`;
  const party = await createBookingParty(db, [
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName, email: `${slug}@example.com` },
  ]);
  if (!party.ok || !party.bookings[0]) throw new Error("booking failed");
  const bookingId = party.bookings[0].bookingId;
  const [seat] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!seat) throw new Error("seat missing");
  const link = await issueCounterLink(db, { shopId: shop.id, bookingId });
  return { db, shop, bookingId, personId: seat.personId, fullName, ...link };
}

/** What the phone that opened the link first sees. */
async function counterState(token: string, now?: Date) {
  const door = await openOnDevice(ctx.db, token, now);
  if (door?.door !== "counter") return "closed" as const;
  return (await getWaiverForToken(ctx.db, door.key, now)).state;
}

describe("the waiver_link capability", () => {
  it("opens its seat's release on the counter door, and nothing under any other purpose", async () => {
    const { db, token, recordId } = await counterSeat();
    const door = await openOnDevice(db, token);
    expect(door).toMatchObject({ door: "counter", key: { kind: "counter", recordId } });
    expect(await counterState(token)).toBe("available");
    for (const purpose of ["courtesy_email_unsubscribe", "shore_alert_confirm"] as const) {
      expect(await verifyCapability(db, { purpose, token })).toBeNull();
    }
  });

  it("is not opened by another purpose's token, nor by a release link to a seat", async () => {
    const { db, shop, personId, recordId } = await counterSeat();
    const other = await issueCapability(db, {
      purpose: "courtesy_email_unsubscribe",
      shopId: shop.id,
      subjectId: personId,
    });
    expect(await waiverLinkDoor(db, other)).toBeNull();
    // A release link is only ever minted for a release with no seat; one that
    // names a seat's release opens nothing.
    const forged = await issueCapability(db, {
      purpose: "release_link",
      shopId: shop.id,
      subjectId: recordId,
    });
    expect(await waiverLinkDoor(db, forged)).toBeNull();
    expect(await waiverLinkDoor(db, "")).toBeNull();
  });

  it("lives no longer than two weeks from its mint, and opens nothing at its deadline", async () => {
    const { token, expiresAt } = await counterSeat();
    const minted = await verifyCapability(ctx.db, { purpose: "waiver_link", token });
    expect(minted?.expiresAt?.getTime()).toBe(expiresAt.getTime());
    expect(expiresAt.getTime() - nowDate().getTime()).toBeLessThanOrEqual(14 * DAY_MS);
    expect(await counterState(token, new Date(expiresAt.getTime() - 1))).toBe("available");
    expect(await counterState(token, expiresAt)).toBe("closed");
  });

  it("takes the end of the day its caller names, never past two weeks (issue 4064)", async () => {
    const { db, shop, recordId } = await counterSeat();
    const now = nowDate();
    const tonight = new Date(now.getTime() + 5 * 60 * MINUTE_MS);
    const link = await mintCapability(db, {
      purpose: "waiver_link",
      shopId: shop.id,
      subjectId: recordId,
      now,
      expiresAt: tonight,
    });
    expect(link.expiresAt).toEqual(tonight);
    const far = await mintCapability(db, {
      purpose: "waiver_link",
      shopId: shop.id,
      subjectId: recordId,
      now,
      expiresAt: new Date(now.getTime() + 30 * DAY_MS),
    });
    expect(far.expiresAt).toEqual(new Date(now.getTime() + 14 * DAY_MS));
  });

  it("a fresh QR for the same release leaves the one before open", async () => {
    const { db, shop, bookingId, token } = await counterSeat();
    // The diver's phone has the first code open.
    const device = await claimCounterLink(db, token);
    if (!device) throw new Error("first claim refused");
    const next = await issueCounterLink(db, { shopId: shop.id, bookingId });
    expect(await waiverLinkDoor(db, token, { device })).toMatchObject({ door: "counter" });
    expect(await counterState(next.token)).toBe("available");
    // The table lets two live codes to one release stand.
    await db.insert(capabilities).values({
      purpose: "waiver_link",
      shopId: shop.id,
      waiverRecordId: next.recordId,
      tokenHash: hashBearerToken("a-third-live-link"),
      expiresAt: next.expiresAt,
    });
  });

  it("is spent by the signature: only the receipt, then nothing once it expires", async () => {
    const { db, token, fullName, expiresAt } = await counterSeat();
    const door = await openOnDevice(db, token);
    if (door?.door !== "counter") throw new Error("counter door missing");
    expect(
      await completeWaiver(db, door.key, {
        signerName: fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
      }),
    ).toMatchObject({ ok: true, idempotent: false });
    const [row] = await db
      .select({ usedAt: capabilities.usedAt })
      .from(capabilities)
      .where(eq(capabilities.tokenHash, hashBearerToken(token)));
    expect(row?.usedAt).not.toBeNull();
    expect(await counterState(token)).toBe("completed");
    // A second submit is refused, never reported as the first one's signature.
    expect(
      await completeWaiver(db, door.key, {
        signerName: fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
      }),
    ).toEqual({ ok: false, reason: "already_signed" });
    expect(
      await recordWaiverDraft(db, door.key, { acknowledged: true, medicalAnswers: clearAnswers }),
    ).toBe(false);
    expect(await counterState(token, expiresAt)).toBe("closed");
  });

  it("opens on any phone, and only the phone that saved through it is its own (issue 4064)", async () => {
    const { db, token } = await counterSeat();
    expect(await waiverLinkDoor(db, token)).toMatchObject({ door: "counter", ownDevice: false });
    const device = await claimCounterLink(db, token);
    if (!device) throw new Error("first claim refused");
    expect(await claimCounterLink(db, token)).toBeNull();
    expect(await waiverLinkDoor(db, token, { device })).toMatchObject({
      door: "counter",
      ownDevice: true,
    });
    // A second phone, after a dead battery, still opens and signs it, but is
    // not shown the first phone's saved answers.
    expect(await waiverLinkDoor(db, token, { device: "another-phone" })).toMatchObject({
      door: "counter",
      ownDevice: false,
    });
  });

  it("is never claimed once it has expired", async () => {
    const { db, token, expiresAt } = await counterSeat();
    expect(await claimCounterLink(db, token, expiresAt)).toBeNull();
    expect(await waiverLinkDoor(db, token, { now: expiresAt })).toBeNull();
  });

  it("refuses a second signature on a signed release and keeps the first answers (attacker S1)", async () => {
    const { db, token, fullName, recordId } = await counterSeat();
    const a = await openOnDevice(db, token);
    const b = await openOnDevice(db, token);
    if (a?.door !== "counter" || b?.door !== "counter") throw new Error("counter door missing");
    const sign = (key: CounterWaiverKey, medicalAnswers: typeof clearAnswers) =>
      completeWaiver(db, key, { signerName: fullName, agreed: true, medicalAnswers });
    expect(await sign(a.key, clearAnswers)).toMatchObject({ ok: true, status: "completed" });
    expect(await sign(b.key, medicalReferralAnswers)).toEqual({
      ok: false,
      reason: "already_signed",
    });
    const [record] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
    expect(record?.status).toBe("completed");
  });

  it("a spent link on a release still unsigned opens nothing", async () => {
    const { db, token } = await counterSeat();
    await db
      .update(capabilities)
      .set({ usedAt: nowDate() })
      .where(eq(capabilities.tokenHash, hashBearerToken(token)));
    expect(await counterState(token)).toBe("closed");
  });

  it("refuses a signature when the link died between the read and the write, and keeps the release unsigned", async () => {
    const { db, token, fullName, recordId } = await counterSeat();
    const door = await openOnDevice(db, token);
    if (door?.door !== "counter") throw new Error("counter door missing");
    await db
      .update(capabilities)
      .set({ revokedAt: nowDate() })
      .where(eq(capabilities.tokenHash, hashBearerToken(token)));
    expect(
      await completeWaiver(db, door.key, {
        signerName: fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    const [record] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
    expect(record?.status).toBe("pending");
  });

  it("opens nothing for another shop's link, and is never minted over another shop's release", async () => {
    const { db, recordId } = await counterSeat();
    const [otherShop] = await db
      .insert(shops)
      .values({
        name: "Other Counter",
        slug: `other-counter-${crypto.randomUUID().slice(0, 8)}`,
        timezone: "UTC",
      })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    await expect(
      mintCapability(db, { purpose: "waiver_link", shopId: otherShop.id, subjectId: recordId }),
    ).rejects.toThrow(/outside its shop/);
    // A live row that names this shop's release under another shop, however
    // it got there.
    await db.insert(capabilities).values({
      purpose: "waiver_link",
      shopId: otherShop.id,
      waiverRecordId: recordId,
      tokenHash: hashBearerToken("cross-shop-counter-link"),
      expiresAt: new Date(nowDate().getTime() + 10 * MINUTE_MS),
    });
    expect(await waiverLinkDoor(db, "cross-shop-counter-link")).toBeNull();
  });

  it("opens nothing once the seat changes hands, is cancelled or is held", async () => {
    const { db, shop, bookingId, token } = await counterSeat();
    const [other] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Someone Else", email: null })
      .returning({ id: people.id });
    if (!other) throw new Error("another diver missing");
    const [seat] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    await db.update(bookings).set({ personId: other.id }).where(eq(bookings.id, bookingId));
    expect(await counterState(token)).toBe("closed");
    await db.update(bookings).set({ personId: seat?.personId }).where(eq(bookings.id, bookingId));
    expect(await counterState(token)).toBe("available");
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Someone" })
      .where(eq(bookings.id, bookingId));
    expect(await counterState(token)).toBe("closed");
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null, status: "cancelled" })
      .where(eq(bookings.id, bookingId));
    expect(await counterState(token)).toBe("closed");
  });

  it("reaches no record through a key it did not make", async () => {
    const { db, shop, bookingId, recordId, token } = await counterSeat();
    const forged: CounterWaiverKey = {
      kind: "counter",
      purpose: "waiver_link",
      shopId: shop.id,
      bookingId,
      recordId,
      token,
      linkId: crypto.randomUUID(),
      expiresAt: new Date(nowMs() + 60_000),
    };
    expect(await getWaiverForToken(db, forged)).toEqual({ state: "unavailable" });
  });

  it("opens nothing after a diver merge that replaces the contact, and the release waits for a fresh code (issue 4057)", async () => {
    const { db, shop, bookingId, token, personId, fullName } = await counterSeat("Jules Merge");
    const [survivor] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName,
        email: `jules-kept-${crypto.randomUUID().slice(0, 6)}@example.com`,
      })
      .returning();
    if (!survivor) throw new Error("survivor insert failed");
    await db.insert(personRoles).values({ personId: survivor.id, role: "diver" });
    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId,
      survivorId: survivor.id,
      actorPersonId: await owner(),
    });
    expect(merged.ok).toBe(true);
    // Authority never follows a merge: the tablet's link is dead. The unsigned
    // release and its draft stay, and a fresh QR opens it for the kept holder.
    expect(await counterState(token)).toBe("closed");
    const fresh = await issueCounterLink(db, { shopId: shop.id, bookingId });
    expect(await counterState(fresh.token)).toBe("available");
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, fresh.recordId));
    expect(record?.personId).toBe(survivor.id);
  });

  it("goes with the person on erasure: the row is deleted and the release opens nothing", async () => {
    const { db, shop, token, personId } = await counterSeat("Eli Erase");
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId,
      actorPersonId: await owner(),
    });
    expect(erased.ok).toBe(true);
    expect(
      await db
        .select()
        .from(capabilities)
        .where(eq(capabilities.tokenHash, hashBearerToken(token))),
    ).toEqual([]);
    expect(await waiverLinkDoor(db, token)).toBeNull();
    expect(await counterState(token)).toBe("closed");
  });
});
