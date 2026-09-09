// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { readKioskInput, surnameOf } from "@/lib/kiosk-check-in";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { seededShopContext } from "@/test/db";
import { checkInAtKiosk } from "./check-in";
import { issueDisplayToken, revokeDisplayToken, verifyDisplayToken } from "./display-tokens";
import { findKioskSeats } from "./kiosk-check-in";
import { listDepartureBoardedBookingIds } from "./manifests";
import { bookingArrivalEvents, bookings, people, rollCallEvents, trips } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
const OTHER_SHOP = "00000000-0000-4000-8000-000000000000";

/**
 * The seeded reef boat, its first seat, and a live check-in link over the same
 * shop. Names are read off the roster rather than written down here: what the
 * lookup is about is the *derivation* — the last whitespace-separated word of
 * whatever the shop recorded — and pinning a cast member's surname in the
 * assertion would make these tests a tripwire on the demo's casting.
 */
async function counter() {
  const { db, shop } = await seededShopContext();
  const upcoming = await upcomingTripsWithCounts(db, shop.id);
  const reef = upcoming.find((trip) => trip.title === "Two-Tank Reef — Molasses & French");
  if (!reef) throw new Error("seeded reef trip missing");
  const roster = await getTripRoster(db, shop.id, reef.id);
  const seat = roster[0];
  if (!seat) throw new Error("seeded booking missing");
  const staff = await listStaff(db, shop.id);
  const owner = staff.find((entry) => entry.roles.includes("owner"));
  if (!owner) throw new Error("seeded shop has no owner");

  const link = await issueDisplayToken(db, {
    shopId: shop.id,
    personId: owner.person.id,
    label: "Counter tablet",
    purpose: "check_in",
    showNames: false,
  });
  if (!link.ok) throw new Error(link.reason);

  return {
    db,
    shop,
    reef,
    link: link.issued,
    booking: seat.booking,
    person: seat.person,
    surname: surnameOf(seat.person.fullName),
  };
}

/** Clears every blocker on the seat, so readiness answers "ready". */
async function clearForBoarding(
  db: Awaited<ReturnType<typeof counter>>["db"],
  shopId: string,
  bookingId: string,
  signerName: string,
) {
  const issued = await issueWaiverRequest(db, { shopId, bookingId });
  if (!issued.ok) throw new Error(issued.reason);
  await completeWaiver(db, issued.token, {
    signerName,
    agreed: true,
    medicalAnswers: clearAnswers,
  });
}

describe("findKioskSeats", () => {
  /**
   * **The row shape is closed, and closing it is the point.** This is read by
   * whoever walks up to an unattended screen, so a widened select is a leak
   * into a lobby rather than a refactor. Adding a key here is a deliberate act
   * that fails this test first.
   */
  it("answers with a narrow row carrying no contact detail, readiness or money", async () => {
    const { db, shop, surname, booking } = await counter();
    const seats = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(surname),
    });
    const found = seats.find((row) => row.bookingId === booking.id);
    expect(found).toBeDefined();
    expect(Object.keys(found ?? {}).sort()).toEqual([
      "bookingId",
      "endsAt",
      "meetingPointAddress",
      "meetingPointLabel",
      "personName",
      "startsAt",
      "tripId",
      "tripTitle",
    ]);
  });

  it("finds the seat by its booking reference", async () => {
    const { db, shop, booking } = await counter();
    const seats = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(booking.id),
    });
    expect(seats.map((row) => row.bookingId)).toEqual([booking.id]);
  });

  /**
   * **Exact and whole-word, never a substring.** A prefix match would let one
   * letter sweep the day's roster off a lobby screen — type "a", read every
   * diver whose name contains one.
   */
  it("refuses a prefix, a fragment and an email address", async () => {
    const { db, shop, surname, person } = await counter();
    const fragment = surname.slice(0, Math.max(1, surname.length - 1));
    expect(await findKioskSeats(db, { shopId: shop.id, lookup: readKioskInput(fragment) })).toEqual(
      [],
    );
    // Loudly, not conditionally: an unseeded email would quietly retire the
    // half of this test that matters most.
    if (!person.email) throw new Error("seeded diver has no email to try");
    expect(
      await findKioskSeats(db, { shopId: shop.id, lookup: readKioskInput(person.email) }),
    ).toEqual([]);
  });

  it("case-folds the typed answer and the stored name alike", async () => {
    const { db, shop, surname, booking } = await counter();
    const shouted = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(surname.toUpperCase()),
    });
    expect(shouted.map((row) => row.bookingId)).toContain(booking.id);
  });

  it("answers nothing for an unusable input, another shop, or a cancelled seat", async () => {
    const { db, shop, surname, booking } = await counter();
    expect(await findKioskSeats(db, { shopId: shop.id, lookup: null })).toEqual([]);
    expect(
      await findKioskSeats(db, { shopId: OTHER_SHOP, lookup: readKioskInput(surname) }),
    ).toEqual([]);

    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    const afterCancel = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(booking.id),
    });
    expect(afterCancel).toEqual([]);
  });

  /**
   * A departure that has already sailed is off the window `arrivalsWindow`
   * bounds, and nobody is arriving for it. The diver who taps at 16:00 for an
   * 08:00 boat gets "see the desk", which is the true answer.
   */
  it("answers nothing for a departure outside the arrivals window", async () => {
    const { db, shop, booking } = await counter();
    const longAgo = new Date(nowDate().getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(
      await findKioskSeats(db, {
        shopId: shop.id,
        lookup: readKioskInput(booking.id),
        now: longAgo,
      }),
    ).toEqual([]);
  });

  /**
   * Two seats behind one surname is not an ambiguity the tablet resolves — but
   * it is one the reader has to be able to *report*, or `kioskSelection` never
   * sees a second row and the whole "several is the same as none" rule is
   * unreachable.
   */
  it("reports more than one match when a surname is shared", async () => {
    const { db, shop, surname, booking } = await counter();
    const roster = await getTripRoster(db, shop.id, booking.tripId);
    const other = roster.find((row) => row.booking.id !== booking.id);
    if (!other) throw new Error("seeded reef boat has only one seat");
    await db
      .update(people)
      .set({ fullName: `Someone ${surname}` })
      .where(eq(people.id, other.person.id));

    const seats = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(surname),
    });
    expect(seats.length).toBeGreaterThan(1);
  });
});

describe("checkInAtKiosk", () => {
  it("records an arrival as the diver's own act, stamped with the tablet", async () => {
    const { db, shop, link, booking, person } = await counter();
    await clearForBoarding(db, shop.id, booking.id, person.fullName);

    const outcome = await checkInAtKiosk(db, {
      shopId: shop.id,
      displayTokenId: link.id,
      bookingId: booking.id,
    });
    expect(outcome).toMatchObject({ ok: true, bookingId: booking.id, alreadyArrived: false });

    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("checked_in");

    const trail = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    const arrival = trail.find((row) => row.displayTokenId === link.id);
    expect(arrival?.status).toBe("arrived");
    // The diver's own act: `recorded_by_person_id` is the diver, and the token
    // beside it is what tells this apart from a staffer's tap on a shop where
    // staff also dive.
    expect(arrival?.recordedByPersonId).toBe(person.id);
  });

  /**
   * **Nothing a diver taps in a lobby may reach the manifest.** Arrival is the
   * desk's question and boarding is the rail's, performed by a crew member with
   * the diver in front of them at roll call. The two vocabularies are kept
   * apart at the table — `arrival_status` has no `boarded` value at all — and
   * this is the assertion that keeps them apart in the code.
   */
  it("leaves the departure's roll call exactly as it found it", async () => {
    const { db, shop, link, booking, person, reef } = await counter();
    await clearForBoarding(db, shop.id, booking.id, person.fullName);
    const before = await db.select().from(rollCallEvents).where(eq(rollCallEvents.tripId, reef.id));
    const boardedBefore = await listDepartureBoardedBookingIds(db, shop.id, [reef.id]);

    await expect(
      checkInAtKiosk(db, { shopId: shop.id, displayTokenId: link.id, bookingId: booking.id }),
    ).resolves.toMatchObject({ ok: true });

    const after = await db.select().from(rollCallEvents).where(eq(rollCallEvents.tripId, reef.id));
    expect(after).toHaveLength(before.length);
    const boardedAfter = await listDepartureBoardedBookingIds(db, shop.id, [reef.id]);
    expect([...boardedAfter].sort()).toEqual([...boardedBefore].sort());
    expect(boardedAfter.has(booking.id)).toBe(false);

    // Belt and braces: no arrival this surface writes can even *say* boarded.
    const trail = await db
      .select({ status: bookingArrivalEvents.status })
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    expect(trail.every((row) => row.status === "arrived" || row.status === "cleared")).toBe(true);
  });

  /**
   * A diver who taps twice, or who was checked in at the desk a minute ago, is
   * asking the question they already asked. Say so warmly rather than refusing
   * — and write nothing the second time.
   */
  it("answers a second tap warmly and writes no second arrival", async () => {
    const { db, shop, link, booking, person } = await counter();
    await clearForBoarding(db, shop.id, booking.id, person.fullName);
    await checkInAtKiosk(db, { shopId: shop.id, displayTokenId: link.id, bookingId: booking.id });
    const afterFirst = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));

    const again = await checkInAtKiosk(db, {
      shopId: shop.id,
      displayTokenId: link.id,
      bookingId: booking.id,
    });
    expect(again).toMatchObject({ ok: true, alreadyArrived: true });
    const afterSecond = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    expect(afterSecond).toHaveLength(afterFirst.length);
  });

  /**
   * Readiness is what turns "You're set" into "See the desk", and it is re-read
   * here rather than trusted from the lookup. A diver whose waiver is unsigned
   * is refused **ashore**, while there is still somebody to talk to — which is
   * the whole reason the counter exists.
   */
  it("refuses a diver readiness will not clear, and leaves the seat booked", async () => {
    const { db, shop, link, booking } = await counter();
    const outcome = await checkInAtKiosk(db, {
      shopId: shop.id,
      displayTokenId: link.id,
      bookingId: booking.id,
    });
    expect(outcome).toEqual({ ok: false, reason: "not_ready" });
    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("booked");
    expect(
      await db
        .select()
        .from(bookingArrivalEvents)
        .where(eq(bookingArrivalEvents.bookingId, booking.id)),
    ).toEqual([]);
  });

  it("refuses a booking belonging to another shop", async () => {
    const { db, link, booking } = await counter();
    expect(
      await checkInAtKiosk(db, {
        shopId: OTHER_SHOP,
        displayTokenId: link.id,
        bookingId: booking.id,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  /**
   * **The writer restates every predicate rather than inheriting one.** The
   * reader already excludes a departure the shop took off the board, so
   * nothing reaches here with a deleted trip's booking id by the normal
   * route — which is exactly why this is worth a test: this door has no
   * staffer behind it, and a second caller trusting the id it was handed is
   * how that stops being true.
   */
  it("refuses a booking on a departure the shop deleted", async () => {
    const { db, shop, link, booking, person, reef } = await counter();
    await clearForBoarding(db, shop.id, booking.id, person.fullName);
    await db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, reef.id));
    expect(
      await checkInAtKiosk(db, {
        shopId: shop.id,
        displayTokenId: link.id,
        bookingId: booking.id,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a seat that is not bookable", async () => {
    const { db, shop, link, booking } = await counter();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    expect(
      await checkInAtKiosk(db, {
        shopId: shop.id,
        displayTokenId: link.id,
        bookingId: booking.id,
      }),
    ).toEqual({ ok: false, reason: "not_bookable" });
  });

  /**
   * Revocation is the one door, and it is the same door the board's is. A
   * revoked tablet stops being able to look anybody up before it gets as far as
   * a booking, because the page and the action both open on
   * `verifyDisplayToken`.
   */
  it("goes dark when the shop revokes the tablet's link", async () => {
    const { db, shop, link } = await counter();
    const staff = await listStaff(db, shop.id);
    const owner = staff.find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("seeded shop has no owner");
    expect(
      await revokeDisplayToken(db, { shopId: shop.id, personId: owner.person.id, id: link.id }),
    ).toBe(true);
    expect(await verifyDisplayToken(db, { token: link.token, purpose: "check_in" })).toBeNull();
  });
});
