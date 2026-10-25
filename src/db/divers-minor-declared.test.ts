// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { getDiverProfile } from "./divers";
import { counterRentalWaiverStandings } from "./gear-counter-rentals";
import { bookings, people, shops, trips } from "./schema";
import { listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";
import { recordInPersonWaiver } from "./waivers-in-person";

/**
 * **The diver record is honest about a declared minor with no date of birth**
 * (issue #2553, Option A, Aaron 2026-10-24). The seat's own roster already
 * asks for a guardian when the booker ticked "Under 18"; the diver record and
 * a counter rental read the person with no seat in hand, and used to say
 * "Signed" over the same solo signature. While any live seat still ahead
 * carries the stamp, they read it too, and the record asks for a date of
 * birth. Nothing here ever writes one.
 */

const ctx = fileScopedShopContext();

/** A fresh diver on the demo reef boat, who signed their release alone. */
async function soloSigner(email: string) {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    { actor: "staff", shopId: shop.id, tripId: reef.id, fullName: "Kit Young", email },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
  if (!issued.ok) throw new Error(`waiver issue failed: ${issued.reason}`);
  const done = await completeWaiver(db, issued.token, {
    signerName: "Kit Young",
    agreed: true,
    medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
  });
  if (!done.ok) throw new Error("waiver completion failed");
  const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!row) throw new Error("seat missing");
  return { db, shop, reef, bookingId, personId: row.personId };
}

type Signer = Awaited<ReturnType<typeof soloSigner>>;

async function declare(s: Signer, bookingId = s.bookingId) {
  await s.db.update(bookings).set({ minorDeclaredAt: nowDate() }).where(eq(bookings.id, bookingId));
}

async function record(s: Signer) {
  const profile = await getDiverProfile(s.db, s.shop.id, s.personId);
  if (!profile) throw new Error("diver record missing");
  return profile;
}

async function counter(s: Signer) {
  const standings = await counterRentalWaiverStandings(s.db, {
    shopId: s.shop.id,
    timezone: s.shop.timezone,
    personIds: [s.personId],
  });
  return standings.get(s.personId)?.state;
}

describe("a declared minor with no date of birth (#2553)", () => {
  it("reads Signed before any seat is declared", async () => {
    const s = await soloSigner("minor-none@example.com");
    const profile = await record(s);
    expect(profile.waiver.state).toBe("current");
    expect(profile.minorDeclared).toBe(false);
    expect(await counter(s)).toBe("current");
  });

  it("reads the solo signature as missing a guardian on the record and at the counter", async () => {
    const s = await soloSigner("minor-declared@example.com");
    await declare(s);
    const profile = await record(s);
    expect(profile.minorDeclared).toBe(true);
    expect(profile.waiver.state).toBe("guardian_missing");
    expect(await counter(s)).toBe("guardian_missing");
    // The stamp is never turned into a date of birth.
    const [person] = await s.db.select().from(people).where(eq(people.id, s.personId));
    expect(person?.dateOfBirth).toBeNull();
  });

  it("asks the record's paper release for the guardian, and stops asking once the seat is gone", async () => {
    const s = await soloSigner("minor-paper@example.com");
    await declare(s);
    const [staff] = await listStaff(s.db, s.shop.id);
    if (!staff) throw new Error("demo staff missing");
    const paper = () =>
      recordInPersonWaiver(s.db, {
        shopId: s.shop.id,
        subject: { personId: s.personId },
        recordedByPersonId: staff.person.id,
        medicalAttested: true,
      });
    expect(await paper()).toEqual({ ok: false, reason: "guardian_required" });

    await s.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, s.bookingId));
    expect(await paper()).toMatchObject({ ok: true });
  });

  it("lets a date of birth on file decide, either way", async () => {
    const adult = await soloSigner("minor-adult-dob@example.com");
    await declare(adult);
    await adult.db
      .update(people)
      .set({ dateOfBirth: "1990-05-01" })
      .where(eq(people.id, adult.personId));
    expect((await record(adult)).waiver.state).toBe("current");
    expect(await counter(adult)).toBe("current");

    const child = await soloSigner("minor-child-dob@example.com");
    await child.db
      .update(people)
      .set({ dateOfBirth: "2016-05-01" })
      .where(eq(people.id, child.personId));
    // No stamp at all: the date alone asks for the guardian.
    expect((await record(child)).waiver.state).toBe("guardian_missing");
  });

  it("ignores a declared seat that was cancelled", async () => {
    const s = await soloSigner("minor-cancelled@example.com");
    await declare(s);
    await s.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, s.bookingId));
    const profile = await record(s);
    expect(profile.minorDeclared).toBe(false);
    expect(profile.waiver.state).toBe("current");
    expect(await counter(s)).toBe("current");
  });

  it("ignores a declared seat on a departure that was deleted, called off, or is over", async () => {
    const s = await soloSigner("minor-departure@example.com");
    await declare(s);
    const [trip] = await s.db.select().from(trips).where(eq(trips.id, s.reef.id));
    if (!trip) throw new Error("trip missing");
    try {
      await s.db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, trip.id));
      expect((await record(s)).waiver.state).toBe("current");
      expect(await counter(s)).toBe("current");

      await s.db
        .update(trips)
        .set({ deletedAt: null, status: "cancelled" })
        .where(eq(trips.id, trip.id));
      expect((await record(s)).waiver.state).toBe("current");
      expect(await counter(s)).toBe("current");

      // Back, and past the late-arrival hour too.
      const over = new Date(nowDate().getTime() - 2 * 3_600_000);
      await s.db
        .update(trips)
        .set({
          status: "scheduled",
          startsAt: new Date(over.getTime() - 4 * 3_600_000),
          endsAt: over,
        })
        .where(eq(trips.id, trip.id));
      expect((await record(s)).minorDeclared).toBe(false);
      expect(await counter(s)).toBe("current");
    } finally {
      await s.db
        .update(trips)
        .set({
          deletedAt: trip.deletedAt,
          status: trip.status,
          startsAt: trip.startsAt,
          endsAt: trip.endsAt,
        })
        .where(eq(trips.id, trip.id));
    }
  });

  it("never reads another shop's seat", async () => {
    const s = await soloSigner("minor-other-shop@example.com");
    await declare(s);
    const [otherShop] = await s.db
      .insert(shops)
      .values({
        name: "Elsewhere Divers",
        timezone: "UTC",
        slug: `elsewhere-${s.personId.slice(0, 8)}`,
      })
      .returning();
    if (!otherShop) throw new Error("shop insert failed");
    const standings = await counterRentalWaiverStandings(s.db, {
      shopId: otherShop.id,
      timezone: s.shop.timezone,
      personIds: [s.personId],
    });
    expect(standings.size).toBe(0);
    expect(await getDiverProfile(s.db, otherShop.id, s.personId)).toBeNull();
  });
});
