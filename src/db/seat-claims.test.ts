// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import type { CertificationLevel } from "@/lib/readiness";
import { seededShopContext } from "@/test/db";
import { issueBookingCapability, verifyBookingCapability } from "./booking-capabilities";
import { cancelBooking, createBookingParty } from "./bookings";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import { getBookingReadiness } from "./readiness";
import {
  bookingCapabilities,
  bookings,
  certifications,
  courses,
  people,
  personRoles,
  shops,
  tripRequirements,
  trips,
  waiverRecords,
} from "./schema";
import { claimPartySeat, getClaimPageData, issuePartySeatClaims } from "./seat-claims";
import { createTrip, listStaff, setTripCrew, upcomingTripsWithCounts } from "./trips";
import { issueWaiverRequest } from "./waivers";

async function seededContext() {
  const { db, shop } = await seededShopContext();
  const tripRows = await upcomingTripsWithCounts(db, shop.id);
  const open = tripRows.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded trip missing");
  return { db, shop, open };
}

/** A party of three: the organizer plus two seats typed by the organizer. */
async function bookParty(db: AppDb, shopId: string, tripId: string) {
  const outcome = await createBookingParty(db, [
    {
      actor: "public",
      shopId,
      tripId,
      fullName: "Orla Organizer",
      email: "orla@example.com",
      phone: "+1-305-555-0100",
    },
    { actor: "public", shopId, tripId, fullName: "Milo Member" },
    { actor: "public", shopId, tripId, fullName: "Pia Member" },
  ]);
  if (!outcome.ok) throw new Error(`party booking failed: ${outcome.reason}`);
  const [lead, memberOne, memberTwo] = outcome.bookings;
  if (!lead || !memberOne || !memberTwo) throw new Error("party booking incomplete");
  return { lead, memberOne, memberTwo };
}

/** Mints one claim link for the given member seat, as the organizer surfaces do. */
async function claimTokenFor(db: AppDb, shopId: string, leadBookingId: string, bookingId: string) {
  const seats = await issuePartySeatClaims(db, { shopId, leadBookingId });
  const seat = seats.find((entry) => entry.bookingId === bookingId);
  if (!seat?.claim) throw new Error("expected a claim link for the member seat");
  return seat.claim.token;
}

async function demandOf(db: AppDb, shopId: string, tripId: string, level: CertificationLevel) {
  await db
    .update(tripRequirements)
    .set({ minimumCertificationLevel: level, requiredSpecialties: [], requiresNitrox: false })
    .where(and(eq(tripRequirements.tripId, tripId), eq(tripRequirements.shopId, shopId)));
}

describe("party linkage (createBookingParty)", () => {
  it("stamps every seat past the organizer's with the lead booking", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);

    const rows = await db
      .select({ id: bookings.id, partyLeadBookingId: bookings.partyLeadBookingId })
      .from(bookings)
      .where(eq(bookings.tripId, open.id));
    const byId = new Map(rows.map((row) => [row.id, row.partyLeadBookingId]));
    expect(byId.get(lead.bookingId)).toBeNull();
    expect(byId.get(memberOne.bookingId)).toBe(lead.bookingId);
    expect(byId.get(memberTwo.bookingId)).toBe(lead.bookingId);
  });

  it("clears stale party linkage when a cancelled seat is reactivated by a fresh booking", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);

    // Give the member seat a claimed identity with an email, cancel it, then
    // let that person book the same trip again on their own.
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    const claimed = await claimPartySeat(db, {
      token,
      fullName: "Milo Member",
      email: "milo@example.com",
    });
    expect(claimed).toMatchObject({ ok: true });
    await cancelBooking(db, shop.id, memberOne.bookingId);

    const rebooked = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Milo Member",
        email: "milo@example.com",
      },
    ]);
    expect(rebooked).toMatchObject({ ok: true });
    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, memberOne.bookingId))
      .limit(1);
    // Same row reactivated — and its party life is over: not listed in the
    // old organizer's panel, not claimable by a link the organizer could mint.
    expect(row?.status).toBe("booked");
    expect(row?.partyLeadBookingId).toBeNull();
    expect(row?.claimedAt).toBeNull();
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.map((seat) => seat.bookingId)).not.toContain(memberOne.bookingId);
  });
});

describe("issuePartySeatClaims", () => {
  it("mints a claim link per unclaimed member seat and never one for the lead", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);

    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.map((seat) => seat.bookingId).sort()).toEqual(
      [memberOne.bookingId, memberTwo.bookingId].sort(),
    );
    for (const seat of seats) {
      expect(seat.claimed).toBe(false);
      expect(seat.claim?.token).toBeTruthy();
    }
  });

  it("reports whether each seat's own current waiver is signed", async () => {
    // The one fact beyond `claimed` the party panel's aggregate line rests on
    // (ADR 20260827-the-divers-thread, slice 7c). A *superseded* record must
    // never count: a claim supersedes the placeholder's paperwork, and a seat
    // reported as signed on a withdrawn waiver is exactly the diver who turns
    // up at the dock with nothing on file.
    const { db, shop, open } = await seededContext();
    const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);

    const unsigned = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(unsigned.every((seat) => seat.waiverSigned)).toBe(false);

    for (const bookingId of [memberOne.bookingId, memberTwo.bookingId]) {
      const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
      if (!issued.ok) throw new Error("waiver setup failed");
      await db
        .update(waiverRecords)
        .set({ status: "completed", signedName: "Party Member", signatureMethod: "typed" })
        .where(eq(waiverRecords.bookingId, bookingId));
    }
    const signed = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(signed.every((seat) => seat.waiverSigned)).toBe(true);

    await db
      .update(waiverRecords)
      .set({ supersededAt: new Date(nowMs()) })
      .where(eq(waiverRecords.bookingId, memberOne.bookingId));
    const afterSuperseding = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(
      afterSuperseding.find((seat) => seat.bookingId === memberOne.bookingId)?.waiverSigned,
    ).toBe(false);
  });

  it("stops minting once the trip has departed but keeps reporting claim status", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    await claimPartySeat(db, { token, fullName: "Milo Member", email: "milo@example.com" });

    await db
      .update(trips)
      .set({
        startsAt: new Date(nowMs() - 2 * 60 * 60 * 1000),
        endsAt: new Date(nowMs() - 60 * 60 * 1000),
      })
      .where(eq(trips.id, open.id));
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.every((seat) => seat.claim === null)).toBe(true);
    expect(seats.find((seat) => seat.bookingId === memberOne.bookingId)?.claimed).toBe(true);
  });

  it("walks nothing for a lead booking id presented against the wrong shop", async () => {
    const { db, shop, open } = await seededContext();
    const { lead } = await bookParty(db, shop.id, open.id);
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("shop setup failed");
    expect(
      await issuePartySeatClaims(db, { shopId: other.id, leadBookingId: lead.bookingId }),
    ).toEqual([]);
  });
});

describe("claimPartySeat", () => {
  it("re-points the seat to the claimant's own identity and starts their own paperwork", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const placeholderPersonId = memberOne.personId;
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);

    // The page read works before the claim...
    const pageData = await getClaimPageData(db, token);
    expect(pageData).toMatchObject({ seatName: "Milo Member", shopSlug: "blue-mantis" });

    const outcome = await claimPartySeat(db, {
      token,
      fullName: "Milo Actual",
      email: "milo@example.com",
      phone: "+1-305-555-0142",
    });
    expect(outcome).toMatchObject({ ok: true, personName: "Milo Actual" });
    if (!outcome.ok) throw new Error("unreachable");

    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, memberOne.bookingId))
      .limit(1);
    expect(row?.personId).toBe(outcome.personId);
    expect(row?.personId).not.toBe(placeholderPersonId);
    expect(row?.claimedAt).not.toBeNull();
    expect(row?.identityUnconfirmedAt).toBeNull();

    // A fresh person with the diver role and the claimant's own contact.
    const [claimant] = await db.select().from(people).where(eq(people.id, outcome.personId));
    expect(claimant).toMatchObject({
      fullName: "Milo Actual",
      email: "milo@example.com",
      phone: "+1-305-555-0142",
    });
    const roles = await db
      .select()
      .from(personRoles)
      .where(eq(personRoles.personId, outcome.personId));
    expect(roles.map((r) => r.role)).toContain("diver");

    // The organizer's panel now shows the seat claimed, with no link to share.
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    const seat = seats.find((entry) => entry.bookingId === memberOne.bookingId);
    expect(seat).toMatchObject({ claimed: true, claim: null, seatName: "Milo Actual" });

    // Their own waiver flow started: a pending waiver record for the claimant.
    const waivers = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, memberOne.bookingId));
    expect(
      waivers.some((record) => record.personId === outcome.personId && !record.supersededAt),
    ).toBe(true);
  });

  it("reuses an existing person by email and flags a name that doesn't match (H-13)", async () => {
    const { db, shop, open } = await seededContext();
    const existing = await createDiver(db, {
      shopId: shop.id,
      fullName: "Sasha Reyes",
      email: "sasha@example.com",
    });
    if (!existing) throw new Error("diver setup failed");
    const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);

    // Matching name: clean reuse, no flag.
    const tokenOne = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    const matched = await claimPartySeat(db, {
      token: tokenOne,
      fullName: "Sasha Reyes",
      email: "sasha@example.com",
    });
    expect(matched).toMatchObject({ ok: true, personId: existing.id, identityUnconfirmed: false });

    // Mismatched name against a second existing person: reused but flagged,
    // so readiness fails closed until staff confirm.
    const second = await createDiver(db, {
      shopId: shop.id,
      fullName: "Tomás Vega",
      email: "tomas@example.com",
    });
    if (!second) throw new Error("diver setup failed");
    const tokenTwo = await claimTokenFor(db, shop.id, lead.bookingId, memberTwo.bookingId);
    const mismatched = await claimPartySeat(db, {
      token: tokenTwo,
      fullName: "Somebody Else",
      email: "tomas@example.com",
      phone: "+1-305-555-0177",
    });
    expect(mismatched).toMatchObject({ ok: true, personId: second.id, identityUnconfirmed: true });
    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, memberTwo.bookingId))
      .limit(1);
    expect(row?.identityUnconfirmedAt).not.toBeNull();
    // An unconfirmed identity writes no contact data onto the matched record.
    const [tomas] = await db.select().from(people).where(eq(people.id, second.id));
    expect(tomas?.phone).toBeNull();
  });

  it("refuses a second claim of the same seat and leaves the first untouched", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    // Two live links for the same seat — a reloaded organizer panel.
    const tokenOne = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    const tokenTwo = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);

    const first = await claimPartySeat(db, {
      token: tokenOne,
      fullName: "Milo Actual",
      email: "milo@example.com",
    });
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) throw new Error("unreachable");

    // The sibling link died with the claim — and so did the used one.
    for (const token of [tokenOne, tokenTwo]) {
      expect(await getClaimPageData(db, token)).toBeNull();
      expect(
        await claimPartySeat(db, { token, fullName: "Second Comer", email: "second@example.com" }),
      ).toEqual({ ok: false, reason: "invalid" });
    }
    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, memberOne.bookingId))
      .limit(1);
    expect(row?.personId).toBe(first.personId);
  });

  it("refuses a claim after the trip has departed", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);

    await db
      .update(trips)
      .set({
        startsAt: new Date(nowMs() - 2 * 60 * 60 * 1000),
        endsAt: new Date(nowMs() - 60 * 60 * 1000),
      })
      .where(eq(trips.id, open.id));

    expect(await getClaimPageData(db, token)).toBeNull();
    expect(
      await claimPartySeat(db, { token, fullName: "Milo Actual", email: "milo@example.com" }),
    ).toEqual({ ok: false, reason: "invalid" });
    // The seat rides under the organizer's party exactly as before.
    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, memberOne.bookingId))
      .limit(1);
    expect(row?.personId).toBe(memberOne.personId);
    expect(row?.claimedAt).toBeNull();
  });

  it("fails closed on a cancelled booking", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    await cancelBooking(db, shop.id, memberOne.bookingId);

    expect(await getClaimPageData(db, token)).toBeNull();
    expect(
      await claimPartySeat(db, { token, fullName: "Milo Actual", email: "milo@example.com" }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("fails closed on a capability whose shop has drifted from its booking's (cross-tenant)", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-claims", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("shop setup failed");
    // Nothing legitimate can cause this drift; the verify path must still refuse.
    await db
      .update(bookingCapabilities)
      .set({ shopId: other.id })
      .where(eq(bookingCapabilities.bookingId, memberOne.bookingId));

    expect(await getClaimPageData(db, token)).toBeNull();
    expect(
      await claimPartySeat(db, { token, fullName: "Milo Actual", email: "milo@example.com" }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a claimant who already holds their own seat on the trip", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);

    // The organizer themselves — one person, one seat.
    const outcome = await claimPartySeat(db, {
      token,
      fullName: "Orla Organizer",
      email: "orla@example.com",
    });
    expect(outcome).toEqual({ ok: false, reason: "already_booked" });
    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, memberOne.bookingId))
      .limit(1);
    expect(row?.personId).toBe(memberOne.personId);
    expect(row?.claimedAt).toBeNull();
  });

  it("re-runs the trip's own admission gate on the claimant's evidence", async () => {
    const { db, shop, open } = await seededContext();
    // A trip the party could book (no evidence, admitted) that a *carded*
    // claimant below the bar must not claim into.
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    await demandOf(db, shop.id, open.id, "advanced_open_water");
    const carded = await createDiver(db, {
      shopId: shop.id,
      fullName: "Cass Marlin",
      email: "cass@example.com",
    });
    if (!carded) throw new Error("diver setup failed");
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: carded.id,
      agency: "padi",
      level: "open_water",
      identifier: "C-claim-1",
      status: "verified",
    });

    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    const outcome = await claimPartySeat(db, {
      token,
      fullName: "Cass Marlin",
      email: "cass@example.com",
    });
    expect(outcome).toMatchObject({
      ok: false,
      reason: "trip_prerequisite",
      refusal: { requiredLevel: "advanced_open_water", heldLevel: "open_water" },
    });
    // Refused claim leaves the seat exactly as it was.
    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, memberOne.bookingId))
      .limit(1);
    expect(row?.personId).toBe(memberOne.personId);
  });

  it("holds a course session's fail-closed card gate against an uncarded claimant", async () => {
    const { db, shop } = await seededContext();
    // A card-gated course session with an instructor, exactly as the booking
    // path requires (mirrors bookings.test.ts's AOW admission setup).
    const [course] = await db
      .insert(courses)
      .values({
        shopId: shop.id,
        title: "Advanced Open Water — claim gate test",
        slug: "aow-claim-gate-test",
        agency: "padi",
        minimumCertificationLevel: "open_water",
      })
      .returning();
    if (!course) throw new Error("course setup failed");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");
    const startsAt = new Date(nowMs() + 200 * 24 * 60 * 60 * 1000);
    const session = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "AOW session — claim gate test",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 5 * 60 * 60 * 1000),
      capacity: 6,
      plannedDives: 2,
    });
    if (!session) throw new Error("course session setup failed");
    if (!(await setTripCrew(db, shop.id, session.id, [instructor.person.id]))) {
      throw new Error("instructor assignment failed");
    }

    // Two carded students the organizer enrols by email — the only way a
    // party seat can exist on a card-gated session at all.
    const organizer = await createDiver(db, {
      shopId: shop.id,
      fullName: "Orla Organizer",
      email: "orla-course@example.com",
    });
    const student = await createDiver(db, {
      shopId: shop.id,
      fullName: "Stud Ent",
      email: "student-course@example.com",
    });
    if (!organizer || !student) throw new Error("diver setup failed");
    for (const person of [organizer, student]) {
      await db.insert(certifications).values({
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        level: "open_water",
        identifier: `C-${person.id.slice(0, 8)}`,
        status: "verified",
      });
    }
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: session.id,
        fullName: "Orla Organizer",
        email: "orla-course@example.com",
      },
      {
        actor: "public",
        shopId: shop.id,
        tripId: session.id,
        fullName: "Stud Ent",
        email: "student-course@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`course party booking failed: ${party.reason}`);
    const memberSeat = party.bookings[1];
    if (!memberSeat) throw new Error("member seat missing");
    const lead = party.bookings[0];
    if (!lead) throw new Error("lead seat missing");

    // An uncarded identity must not take the student's seat over.
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberSeat.bookingId);
    expect(
      await claimPartySeat(db, {
        token,
        fullName: "No Card",
        email: "nocard@example.com",
      }),
    ).toEqual({ ok: false, reason: "course_prerequisite" });
    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, memberSeat.bookingId))
      .limit(1);
    expect(row?.personId).toBe(memberSeat.personId);
    expect(row?.claimedAt).toBeNull();

    // The carded student themselves claims their own seat fine.
    const tokenTwo = await claimTokenFor(db, shop.id, lead.bookingId, memberSeat.bookingId);
    expect(
      await claimPartySeat(db, {
        token: tokenTwo,
        fullName: "Stud Ent",
        email: "student-course@example.com",
      }),
    ).toMatchObject({ ok: true, personId: student.id });
  });

  it("supersedes the placeholder's waiver so the claimant can never board on it", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    // The organizer relayed paperwork the old way: a waiver issued (and even
    // completed) against the placeholder identity.
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: memberOne.bookingId,
    });
    if (!issued.ok) throw new Error("waiver setup failed");
    await db
      .update(waiverRecords)
      .set({ status: "completed", signedName: "Milo Member", signatureMethod: "typed" })
      .where(eq(waiverRecords.bookingId, memberOne.bookingId));

    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    const outcome = await claimPartySeat(db, {
      token,
      fullName: "Milo Actual",
      email: "milo@example.com",
    });
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) throw new Error("unreachable");

    const records = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, memberOne.bookingId));
    const placeholderRecords = records.filter((r) => r.personId !== outcome.personId);
    expect(placeholderRecords.length).toBeGreaterThan(0);
    expect(placeholderRecords.every((r) => r.supersededAt !== null)).toBe(true);

    // Readiness reads the claimant as still owing their own signature.
    const readiness = await getBookingReadiness(db, shop.id, memberOne.bookingId);
    expect(readiness?.status).not.toBe("ready");
    expect(readiness?.blockers.some((blocker) => blocker.code.startsWith("waiver_"))).toBe(true);
  });

  it("revokes every pre-claim capability over the booking, whatever its purpose", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const readiness = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: memberOne.bookingId,
      purpose: "readiness",
    });
    if (!readiness) throw new Error("readiness capability setup failed");
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);

    const outcome = await claimPartySeat(db, {
      token,
      fullName: "Milo Actual",
      email: "milo@example.com",
    });
    expect(outcome).toMatchObject({ ok: true });

    // The pre-claim readiness link was authority over the placeholder's seat;
    // it must not survive as authority over the claimant's.
    expect(
      await verifyBookingCapability(db, { token: readiness.token, purpose: "readiness" }),
    ).toBeNull();
  });
});
