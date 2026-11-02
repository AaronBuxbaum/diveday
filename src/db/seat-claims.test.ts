// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import type { CertificationLevel } from "@/lib/readiness";
import { DEFAULT_WAIVER_BODY, WAIVER_SIGNATURE_VALIDITY_MS } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { issueBookingCapability, verifyBookingCapability } from "./booking-capabilities";
import { cancelBooking, createBookingParty } from "./bookings";
import type { AppDb } from "./client";
import { mergeDiverRecords } from "./diver-merge";
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
import {
  claimPartySeat,
  getClaimPageData,
  getClaimPageState,
  issuePartySeatClaims,
  openMinorSeatWaiver,
  partyLeadReturnToken,
  partySeatsKeptAfterLeadCancel,
} from "./seat-claims";
import { createTrip, listStaff, setTripCrew, upcomingTripsWithCounts } from "./trips";
import { getWaiverSignerOnFile } from "./waiver-signing";
import { issueWaiverRequest, saveWaiverTemplate } from "./waivers";
import { getWaiverForToken } from "./waivers-completion";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

async function seededContext() {
  const { db, shop } = ctx;
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

/** The person a seat is booked to. */
async function personOfSeat(db: AppDb, bookingId: string): Promise<string> {
  const [seat] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!seat) throw new Error("seat missing");
  return seat.personId;
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

  it("clears stale party linkage when a canceled seat is reactivated by a fresh booking", async () => {
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
  it("marks which seats a lead's cancel would take: unclaimed, booked, on the lead's departure (batch 6 item 10)", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);
    await db
      .update(bookings)
      .set({ claimedAt: new Date(nowMs()) })
      .where(eq(bookings.id, memberTwo.bookingId));
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    const goes = new Map(seats.map((seat) => [seat.bookingId, seat.cancelsWithLead]));
    expect(goes.get(memberOne.bookingId)).toBe(true);
    expect(goes.get(memberTwo.bookingId)).toBe(false);

    const kept = await partySeatsKeptAfterLeadCancel(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(kept).toEqual(expect.arrayContaining(["Milo Member", "Pia Member"]));
  });

  it("names as kept only the seats on the lead's own departure (batch 6 layer 2 review)", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);
    const other = (await upcomingTripsWithCounts(db, shop.id)).find((t) => t.id !== open.id);
    if (!other) throw new Error("expected a second seeded trip");
    // Pia was moved to another departure: she keeps her seat, but not "on" the
    // lead's trip, which is what the cancelled page's sentence names.
    await db.update(bookings).set({ tripId: other.id }).where(eq(bookings.id, memberTwo.bookingId));
    await db
      .update(bookings)
      .set({ claimedAt: new Date(nowMs()) })
      .where(eq(bookings.id, memberOne.bookingId));

    const kept = await partySeatsKeptAfterLeadCancel(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(kept).toEqual(["Milo Member"]);
  });

  /**
   * **A held seat goes by the name it was booked under** (security review of
   * issue #2125). A party seat typed with somebody else's email is matched to
   * that person's record and held; the organizer's /ready panel reads this
   * list, so printing the matched record's name told whoever typed the email
   * whose record it reached.
   */
  it("names a held seat as it was booked, never the matched person", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: new Date(nowMs()), identityBookedAs: "Milo Typed" })
      .where(eq(bookings.id, memberOne.bookingId));
    const [person] = await db
      .select({ id: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, memberOne.bookingId));
    await db
      .update(people)
      .set({ fullName: "Victim Matched-Record" })
      .where(eq(people.id, person?.id ?? ""));

    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    const held = seats.find((seat) => seat.bookingId === memberOne.bookingId);
    expect(held?.seatName).toBe("Milo Typed");
    expect(JSON.stringify(seats)).not.toContain("Victim");
    // And the claim page that seat's link opens says the same.
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    const page = await getClaimPageData(db, token);
    expect(page?.seatName).toBe("Milo Typed");
  });

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

  /**
   * **The one reader on issue #1753's list production reaches.** Every row
   * this query returns is one party, and `createBookingParty` writes the whole
   * party in a single transaction with `createBooking` stamping `nowDate()`
   * per seat at millisecond resolution — so two seats typed into one form
   * sharing a `created_at` is ordinary rather than unlucky. Under the frozen
   * test clock it is certain: all three seats below share one instant.
   *
   * The panel (`PartyClaimPanel`) renders this array in order, so the
   * organizer's list of who still has to claim was ordered by a
   * `defaultRandom()` uuid.
   *
   * The ids are forced and the **alphabetically-first seat is given the higher
   * uuid**, so the old `asc(bookings.id)` clause answers the exact opposite
   * every time rather than half the time.
   */
  it("orders a party's seats by the seat's name, not by whichever uuid sorted higher", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);

    const [{ createdAt }] = await db
      .select({ createdAt: bookings.createdAt })
      .from(bookings)
      .where(eq(bookings.id, lead.bookingId))
      .limit(1);
    const [{ createdAt: memberCreatedAt }] = await db
      .select({ createdAt: bookings.createdAt })
      .from(bookings)
      .where(eq(bookings.id, memberOne.bookingId))
      .limit(1);
    // The premise this test rests on: the party's seats already tie, written
    // by the application clock rather than the column's `defaultNow()`.
    expect(memberCreatedAt).toEqual(createdAt);

    // "Milo Member" sorts before "Pia Member"; give Milo the higher uuid.
    const lower = "00000000-0000-4000-8000-000000000001";
    const higher = "00000000-0000-4000-8000-000000000002";
    await db.update(bookings).set({ id: lower }).where(eq(bookings.id, memberTwo.bookingId));
    await db.update(bookings).set({ id: higher }).where(eq(bookings.id, memberOne.bookingId));

    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.map((seat) => seat.seatName)).toEqual(["Milo Member", "Pia Member"]);
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
        .set({
          status: "completed",
          signedName: "Party Member",
          signatureMethod: "typed",
          signedAt: new Date(nowMs()),
          completedAt: new Date(nowMs()),
        })
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

  it("never reports a seat signed on a release that lapsed (D3)", async () => {
    // "Signed" on the organizer's panel is the sign-once question: a release
    // aged past its year, or signed against terms the shop has since changed,
    // is one the diver signs again (`isCompletedWaiverCurrent`).
    const { db, shop, open } = await seededContext();
    const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);
    const longAgo = new Date(nowMs() - WAIVER_SIGNATURE_VALIDITY_MS - 60_000);
    for (const [bookingId, signedAt] of [
      [memberOne.bookingId, longAgo],
      [memberTwo.bookingId, new Date(nowMs())],
    ] as const) {
      const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
      if (!issued.ok) throw new Error("waiver setup failed");
      await db
        .update(waiverRecords)
        .set({
          status: "completed",
          signedName: "Party Member",
          signatureMethod: "typed",
          signedAt,
          completedAt: signedAt,
        })
        .where(eq(waiverRecords.bookingId, bookingId));
    }
    const seatSigned = async (bookingId: string) =>
      (await issuePartySeatClaims(db, { shopId: shop.id, leadBookingId: lead.bookingId })).find(
        (seat) => seat.bookingId === bookingId,
      )?.waiverSigned;
    expect(await seatSigned(memberOne.bookingId)).toBe(false);
    expect(await seatSigned(memberTwo.bookingId)).toBe(true);

    const terms = await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: `${DEFAULT_WAIVER_BODY}\n\nRevised terms.`,
      material: true,
    });
    expect(terms.versioned).toBe(true);
    expect(await seatSigned(memberTwo.bookingId)).toBe(false);
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

  it("mints nothing once the shop calls the departure off", async () => {
    // The other half of what a dead claim page may promise: for a cancelled
    // departure there is no link to ask the organizer for, because this is the
    // only place one is ever minted and `claimableNow` refuses a trip that
    // isn't scheduled. A dead card telling that diver to ask for a fresh one
    // sends them to a panel that shows names and no links.
    const { db, shop, open } = await seededContext();
    const { lead } = await bookParty(db, shop.id, open.id);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, open.id));

    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.length).toBeGreaterThan(0);
    expect(seats.every((seat) => seat.claim === null)).toBe(true);
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
      // Stored E.164, not as the claimant typed it (src/db/person-phone.ts).
      phone: "+13055550142",
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

  it("reuses an existing person by email and flags a name that doesn't match (H-20260724-one-person-per-email)", async () => {
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

  it("stores the claimant's number onto the matched record in E.164", async () => {
    const { db, shop, open } = await seededContext();
    const existing = await createDiver(db, {
      shopId: shop.id,
      fullName: "Sasha Reyes",
      email: "sasha@example.com",
    });
    if (!existing) throw new Error("diver setup failed");
    expect(existing.phone).toBeNull();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);

    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    const matched = await claimPartySeat(db, {
      token,
      fullName: "Sasha Reyes",
      email: "sasha@example.com",
      phone: "305-555-0142",
    });
    expect(matched).toMatchObject({ ok: true, personId: existing.id, identityUnconfirmed: false });

    // Not the bare national number the claimant typed. A public form is exactly
    // where an unnormalised row comes from, and a bare row's meaning follows
    // the shop's address field rather than the row (src/db/person-phone.ts).
    const [sasha] = await db.select().from(people).where(eq(people.id, existing.id));
    expect(sasha?.phone).toBe("+13055550142");
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

  it("fails closed on a canceled booking", async () => {
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
    expect(outcome).toMatchObject({ ok: false, reason: "already_booked" });
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

  it("answers a carded claimant below the bar the same way whether or not they hold a seat here (issue #2288)", async () => {
    // Adversarial: the link's holder types someone else's email. A refusal
    // only a passenger can earn would confirm that person is on the manifest,
    // so the trip's own gate answers first, for passenger and stranger alike.
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    await demandOf(db, shop.id, open.id, "advanced_open_water");
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: lead.personId,
      agency: "padi",
      level: "open_water",
      identifier: "C-claim-oracle",
      status: "verified",
    });
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    // The organizer holds a seat on this trip and an Open Water card.
    const outcome = await claimPartySeat(db, {
      token,
      fullName: "Orla Organizer",
      email: "orla@example.com",
    });
    expect(outcome).toMatchObject({ ok: false, reason: "trip_prerequisite" });
  });

  it("asks a rider's seat for no card: a claimant with a lower card on file still claims it", async () => {
    // Regression (dive-domain review, PR #2224): the claim re-ran the trip's
    // card gate as if every seat were a diver's, so a rider holding an Open
    // Water card was refused an Advanced trip she was never going to dive.
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    await db
      .update(bookings)
      .set({ participantType: "rider", bookedAs: "rider" })
      .where(eq(bookings.id, memberOne.bookingId));
    await demandOf(db, shop.id, open.id, "advanced_open_water");
    const carded = await createDiver(db, {
      shopId: shop.id,
      fullName: "Rita Deck",
      email: "rita@example.com",
    });
    if (!carded) throw new Error("diver setup failed");
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: carded.id,
      agency: "padi",
      level: "open_water",
      identifier: "C-claim-rider",
      status: "verified",
    });

    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    const outcome = await claimPartySeat(db, {
      token,
      fullName: "Rita Deck",
      email: "rita@example.com",
    });
    expect(outcome).toMatchObject({ ok: true });
    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, memberOne.bookingId))
      .limit(1);
    expect(row?.personId).toBe(carded.id);
    expect(row?.participantType).toBe("rider");
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

/**
 * **The dead-link law's booking tier, on the claim link** (ADR
 * 20260827-first-light, decisions 3 and 4).
 *
 * The rule, not the pixels: a claim token that still resolves to a capability
 * row *this app issued* may name the shop that issued it, because the party
 * member holding a dead URL from a group chat has exactly one question and it
 * is who to ask. A token that resolves to nothing at all may name nothing —
 * the guarantee the whole capability model rests on is that a bearer token
 * reveals only its own record, and an unresolvable token has no record.
 *
 * Note what "readable" does *not* mean: it is not "verifiable". A live token
 * over a boat that has already sailed verifies fine, can claim nothing, and
 * still earns the shop's hand — which is the case a diver is likeliest to be
 * holding.
 */
describe("getClaimPageState (what a dead claim link may name)", () => {
  it("renders the form while the seat can still change hands", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);

    const state = await getClaimPageState(db, token);
    expect(state.kind).toBe("claimable");
    if (state.kind !== "claimable") throw new Error("unreachable");
    expect(state.data.shopName).toBe(shop.name);
    expect(state.data.seatName).toBe("Milo Member");
  });

  it("names the shop on a spent link — the ordinary dead claim", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    // Claiming revokes every capability on the booking, including this one.
    expect(
      await claimPartySeat(db, { token, fullName: "Milo Actual", email: "milo@example.com" }),
    ).toMatchObject({ ok: true });

    const state = await getClaimPageState(db, token);
    expect(state).toEqual({
      kind: "dead",
      shop: {
        name: shop.name,
        contactEmail: shop.contactEmail,
        contactPhone: shop.contactPhone,
        defaultLocale: shop.defaultLocale,
      },
    });
  });

  it("names the shop on an expired link", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    await db
      .update(bookingCapabilities)
      .set({ expiresAt: new Date(nowMs() - 60 * 60 * 1000) })
      .where(eq(bookingCapabilities.bookingId, memberOne.bookingId));

    const state = await getClaimPageState(db, token);
    expect(state.kind).toBe("dead");
    if (state.kind !== "dead") throw new Error("unreachable");
    expect(state.shop.name).toBe(shop.name);
  });

  it("names the shop on a live link whose boat has already sailed", async () => {
    // "Readable" is not "verifiable": this token verifies fine and the seat
    // simply cannot change hands any more. The diver still deserves the hand.
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
    const state = await getClaimPageState(db, token);
    expect(state.kind).toBe("dead");
    if (state.kind !== "dead") throw new Error("unreachable");
    expect(state.shop.name).toBe(shop.name);
  });

  /**
   * **The two causes that decide what the sentence may say.**
   *
   * A shop calls Saturday off for weather, or takes one seat off the boat.
   * `verifyBookingCapability` fails closed on both — cancelling the trip
   * revokes nothing and simply stops verifying, cancelling the seat revokes
   * every link over it — so both land here, in the same arm as a spent link,
   * and every party member who taps the URL the organizer forwarded into the
   * group chat reads whatever that arm says. They are the reason it may not say
   * the seat is safe or offer a fresh link: for these two the seat is gone, and
   * the organizer's panel has nothing left to hand out (the
   * `issuePartySeatClaims` test above).
   */
  it("names the shop when the shop called the departure off", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, open.id));

    expect(await getClaimPageData(db, token)).toBeNull();
    const state = await getClaimPageState(db, token);
    expect(state.kind).toBe("dead");
    if (state.kind !== "dead") throw new Error("unreachable");
    expect(state.shop.name).toBe(shop.name);
  });

  it("names the shop when the seat itself was canceled", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne } = await bookParty(db, shop.id, open.id);
    const token = await claimTokenFor(db, shop.id, lead.bookingId, memberOne.bookingId);
    await cancelBooking(db, shop.id, memberOne.bookingId);

    expect(await getClaimPageData(db, token)).toBeNull();
    const state = await getClaimPageState(db, token);
    expect(state.kind).toBe("dead");
    if (state.kind !== "dead") throw new Error("unreachable");
    expect(state.shop.name).toBe(shop.name);
  });

  it("names nothing at all for a token that was never ours", async () => {
    const { db } = await seededContext();
    // `toEqual` on the whole answer, not a property check: the assertion that
    // matters is that no shop reaches the caller by any route.
    expect(await getClaimPageState(db, "not-a-real-token")).toEqual({ kind: "unknown" });
  });

  it("names nothing when the token was issued for a different purpose", async () => {
    // Purpose binding is part of "ours": a readiness link is not a claim link,
    // and holding one must not turn the claim page into a shop oracle.
    const { db, shop, open } = await seededContext();
    const { memberOne } = await bookParty(db, shop.id, open.id);
    const readiness = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: memberOne.bookingId,
      purpose: "readiness",
    });
    if (!readiness) throw new Error("readiness capability setup failed");

    expect(await getClaimPageState(db, readiness.token)).toEqual({ kind: "unknown" });
  });
});

/**
 * H-20261014-parent-signs-minor-release (ADR 20261014-parent-signs-minor-release): a parent signs a child's
 * release from their own page. Only a seat this lead booked and declared
 * "Under 18", still unclaimed, not held and owing a release opens; everything
 * else is one refusal.
 */
describe("a parent signs a minor seat's release", () => {
  async function familyParty() {
    const { db, shop, open } = await seededContext();
    const outcome = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Dana Parent",
        email: "dana.parent@example.com",
      },
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Mia Child",
        minorDeclared: true,
      },
      { actor: "public", shopId: shop.id, tripId: open.id, fullName: "Lee Friend" },
    ]);
    if (!outcome.ok) throw new Error(`party booking failed: ${outcome.reason}`);
    const [lead, mia, lee] = outcome.bookings;
    if (!lead || !mia || !lee) throw new Error("party booking incomplete");
    return { db, shop, open, lead, mia, lee };
  }

  it("offers it on the minor's seat and not on an adult friend's", async () => {
    const { db, shop, lead, mia, lee } = await familyParty();
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.find((seat) => seat.bookingId === mia.bookingId)?.signForMinor).toBe(true);
    expect(seats.find((seat) => seat.bookingId === lee.bookingId)?.signForMinor).toBe(false);
  });

  it("opens the minor's own release, which asks for a guardian", async () => {
    const { db, shop, lead, mia } = await familyParty();
    const opened = await openMinorSeatWaiver(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      seatBookingId: mia.bookingId,
    });
    if (!opened.ok) throw new Error("expected the minor's release to open");
    const [record] = await db
      .select({ bookingId: waiverRecords.bookingId, status: waiverRecords.status })
      .from(waiverRecords)
      .where(and(eq(waiverRecords.bookingId, mia.bookingId)));
    expect(record).toMatchObject({ bookingId: mia.bookingId, status: "pending" });
    // The link the parent lands on is Mia's release, and it asks for a guardian.
    const onPage = await getWaiverForToken(db, opened.token);
    if (onPage.state !== "available")
      throw new Error(`expected a signable link, got ${onPage.state}`);
    expect(onPage.record.bookingId).toBe(mia.bookingId);
    const signer = await getWaiverSignerOnFile(db, onPage.record);
    expect(signer).toMatchObject({ fullName: "Mia Child", minorDeclared: true });
    // The same live link on a second tap, not a pile of them.
    const again = await openMinorSeatWaiver(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      seatBookingId: mia.bookingId,
    });
    expect(again).toMatchObject({ ok: true });
  });

  it("refuses an adult's seat, another lead's seat, another shop, and the lead's own seat", async () => {
    const { db, shop, lead, mia, lee } = await familyParty();
    const other = await bookParty(db, shop.id, (await seededContext()).open.id);
    const tries = [
      { shopId: shop.id, leadBookingId: lead.bookingId, seatBookingId: lee.bookingId },
      { shopId: shop.id, leadBookingId: other.lead.bookingId, seatBookingId: mia.bookingId },
      {
        shopId: "00000000-0000-4000-8000-000000000000",
        leadBookingId: lead.bookingId,
        seatBookingId: mia.bookingId,
      },
      { shopId: shop.id, leadBookingId: lead.bookingId, seatBookingId: lead.bookingId },
    ];
    for (const input of tries) {
      expect(await openMinorSeatWaiver(db, input)).toEqual({ ok: false });
    }
  });

  it("stops once the seat is claimed: the claimant signs from their own link", async () => {
    const { db, shop, lead, mia } = await familyParty();
    const token = await claimTokenFor(db, shop.id, lead.bookingId, mia.bookingId);
    expect(
      await claimPartySeat(db, { token, fullName: "Mia Child", email: "mia.child@example.com" }),
    ).toMatchObject({ ok: true });
    expect(
      await openMinorSeatWaiver(db, {
        shopId: shop.id,
        leadBookingId: lead.bookingId,
        seatBookingId: mia.bookingId,
      }),
    ).toEqual({ ok: false });
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.find((seat) => seat.bookingId === mia.bookingId)?.signForMinor).toBe(false);
  });

  it("tells the minor's claim page that a parent signs with them", async () => {
    const { db, shop, lead, mia, lee } = await familyParty();
    const miaPage = await getClaimPageData(
      db,
      await claimTokenFor(db, shop.id, lead.bookingId, mia.bookingId),
    );
    const leePage = await getClaimPageData(
      db,
      await claimTokenFor(db, shop.id, lead.bookingId, lee.bookingId),
    );
    expect(miaPage?.minorDeclared).toBe(true);
    expect(leePage?.minorDeclared).toBe(false);
  });

  /**
   * Security review of H-20261014-parent-signs-minor-release: a seat typed with a known diver's own name and
   * email lands on that diver's record, not held, because the names match. The
   * lead must not be able to sign that person's release as their "guardian".
   */
  it("never opens a release for a diver the shop already knows", async () => {
    const { db, shop, open } = await seededContext();
    await createDiver(db, {
      shopId: shop.id,
      fullName: "Vera Known",
      email: "vera.known@example.com",
    });
    const outcome = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Eve Booker",
        email: "eve.booker@example.com",
      },
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Vera Known",
        email: "vera.known@example.com",
        minorDeclared: true,
      },
    ]);
    if (!outcome.ok) throw new Error(`party booking failed: ${outcome.reason}`);
    const [lead, vera] = outcome.bookings;
    if (!lead || !vera) throw new Error("party booking incomplete");
    // Not held: the names match, so only the email rule stands in the way.
    expect(vera.identityUnconfirmed).toBe(false);
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.find((seat) => seat.bookingId === vera.bookingId)?.signForMinor).toBe(false);
    expect(
      await openMinorSeatWaiver(db, {
        shopId: shop.id,
        leadBookingId: lead.bookingId,
        seatBookingId: vera.bookingId,
      }),
    ).toEqual({ ok: false });
  });

  it("never opens one when the date of birth on file says the diver is an adult", async () => {
    const { db, shop, lead, mia } = await familyParty();
    const [seat] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, mia.bookingId));
    if (!seat) throw new Error("seat missing");
    await db.update(people).set({ dateOfBirth: "1990-01-01" }).where(eq(people.id, seat.personId));
    expect(
      await openMinorSeatWaiver(db, {
        shopId: shop.id,
        leadBookingId: lead.bookingId,
        seatBookingId: mia.bookingId,
      }),
    ).toEqual({ ok: false });
  });

  /**
   * Security review F1: a seat whose person staff removed or erased is not a
   * release anyone signs from the party panel, and a removed lead opens none.
   */
  it.each(["removed", "erased"] as const)("never opens a release on a %s record", async (state) => {
    const { db, shop, lead, mia } = await familyParty();
    const personId = await personOfSeat(db, mia.bookingId);
    await db
      .update(people)
      .set(
        state === "removed"
          ? { deletedAt: new Date(nowMs()) }
          : { deletedAt: new Date(nowMs()), anonymizedAt: new Date(nowMs()) },
      )
      .where(eq(people.id, personId));
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.find((seat) => seat.bookingId === mia.bookingId)?.signForMinor).toBe(false);
    expect(
      await openMinorSeatWaiver(db, {
        shopId: shop.id,
        leadBookingId: lead.bookingId,
        seatBookingId: mia.bookingId,
      }),
    ).toEqual({ ok: false });
  });

  it("never opens one when the lead's own record is removed", async () => {
    const { db, shop, lead, mia } = await familyParty();
    await db
      .update(people)
      .set({ deletedAt: new Date(nowMs()) })
      .where(eq(people.id, await personOfSeat(db, lead.bookingId)));
    expect(
      await openMinorSeatWaiver(db, {
        shopId: shop.id,
        leadBookingId: lead.bookingId,
        seatBookingId: mia.bookingId,
      }),
    ).toEqual({ ok: false });
  });

  /**
   * Security review F2: "a person this booking made" is about the record, not
   * its email. A walk-in the shop already knows has no address either; once a
   * staff merge points the seat at that record, the lead signs nothing for it.
   */
  it("never opens one after a merge points the seat at a known diver with no email", async () => {
    const { db, shop, open, lead, mia } = await familyParty();
    const otherTrip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (trip) => trip.id !== open.id,
    );
    if (!otherTrip) throw new Error("expected a second seeded trip");
    const earlier = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: otherTrip.id,
        fullName: "Gus Guardian",
        email: "gus.guardian@example.com",
      },
      { actor: "public", shopId: shop.id, tripId: otherTrip.id, fullName: "Mia Child" },
    ]);
    if (!earlier.ok) throw new Error(`earlier booking failed: ${earlier.reason}`);
    const knownSeat = earlier.bookings[1];
    if (!knownSeat) throw new Error("earlier party incomplete");
    const known = await personOfSeat(db, knownSeat.bookingId);
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: await personOfSeat(db, mia.bookingId),
      survivorId: known,
      actorPersonId: owner.id,
    });
    expect(merged).toMatchObject({ ok: true });
    expect(await personOfSeat(db, mia.bookingId)).toBe(known);
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.find((seat) => seat.bookingId === mia.bookingId)?.signForMinor).toBe(false);
    expect(
      await openMinorSeatWaiver(db, {
        shopId: shop.id,
        leadBookingId: lead.bookingId,
        seatBookingId: mia.bookingId,
      }),
    ).toEqual({ ok: false });
  });

  /**
   * Dive-domain review F4 of layer r4-1: a teen with an address of their own
   * gets no parent's door (the security rule stands), so neither their claim
   * page nor the lead's panel may promise one. The panel says the path that
   * is left: send the link, and a parent or guardian signs with them.
   */
  it("promises the parent's door only where it exists, and says the link otherwise", async () => {
    const { db, shop, open } = await seededContext();
    const outcome = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Pat Parent",
        email: "pat.parent@example.com",
      },
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Kai Kid",
        minorDeclared: true,
      },
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Tess Teen",
        email: "tess.teen@example.com",
        minorDeclared: true,
      },
    ]);
    if (!outcome.ok) throw new Error(`party booking failed: ${outcome.reason}`);
    const [lead, kai, tess] = outcome.bookings;
    if (!lead || !kai || !tess) throw new Error("party booking incomplete");
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.find((seat) => seat.bookingId === kai.bookingId)).toMatchObject({
      signForMinor: true,
      minorNote: null,
    });
    expect(seats.find((seat) => seat.bookingId === tess.bookingId)).toMatchObject({
      signForMinor: false,
      minorNote: "send_link",
    });
    const kaiPage = await getClaimPageData(
      db,
      await claimTokenFor(db, shop.id, lead.bookingId, kai.bookingId),
    );
    const tessPage = await getClaimPageData(
      db,
      await claimTokenFor(db, shop.id, lead.bookingId, tess.bookingId),
    );
    expect(kaiPage).toMatchObject({ minorDeclared: true, parentCanSign: true });
    expect(tessPage).toMatchObject({ minorDeclared: true, parentCanSign: false });
  });

  /**
   * Dive-domain review N7 of layer r4-1: a physician referral on the child's
   * form closes the parent's door (it must block), and the panel says why
   * rather than going silent.
   */
  it("says a physician's form is needed when the child's medical referred them", async () => {
    const { db, shop, lead, mia } = await familyParty();
    const opened = await openMinorSeatWaiver(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      seatBookingId: mia.bookingId,
    });
    expect(opened).toMatchObject({ ok: true });
    await db
      .update(waiverRecords)
      .set({ status: "medical_review", signedAt: new Date(nowMs()) })
      .where(eq(waiverRecords.bookingId, mia.bookingId));
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.find((seat) => seat.bookingId === mia.bookingId)).toMatchObject({
      signForMinor: false,
      minorNote: "physician",
    });
  });

  /**
   * Dive-domain review F6 of layer r4-1: a parent who signs from the party
   * panel goes back to their own page, so the next child is one tap away.
   * The return only ever names the lead's own readiness link, handed in by
   * the lead's own tap, and only for a seat in that lead's party.
   */
  it("returns the parent to their own page, and nobody else to it", async () => {
    const { db, shop, lead, mia } = await familyParty();
    const leadLink = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: lead.bookingId,
      purpose: "readiness",
    });
    if (!leadLink) throw new Error("expected a readiness link");
    const miaLink = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: mia.bookingId,
      purpose: "readiness",
    });
    if (!miaLink) throw new Error("expected a readiness link");
    expect(
      await partyLeadReturnToken(db, {
        shopId: shop.id,
        seatBookingId: mia.bookingId,
        leadToken: leadLink.token,
      }),
    ).toBe(leadLink.token);
    // A link that is not the seat's lead, a stranger's string, or another shop: no return.
    for (const input of [
      { shopId: shop.id, seatBookingId: mia.bookingId, leadToken: miaLink.token },
      { shopId: shop.id, seatBookingId: mia.bookingId, leadToken: "not-a-token" },
      { shopId: shop.id, seatBookingId: lead.bookingId, leadToken: leadLink.token },
      {
        shopId: "00000000-0000-4000-8000-000000000000",
        seatBookingId: mia.bookingId,
        leadToken: leadLink.token,
      },
    ]) {
      expect(await partyLeadReturnToken(db, input)).toBeNull();
    }
  });
});
