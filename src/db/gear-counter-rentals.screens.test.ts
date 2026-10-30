import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowMs } from "@/lib/clock";
import { counterRentalWaiverFlag } from "@/lib/counter-rentals";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { advanceClock } from "@/test/clock";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { latestServiceClocks, recordGearService } from "./gear";
import {
  checkOutCounterRental,
  counterRentalsHeldDuring,
  counterRentalWaiverStandings,
  createCounterRental,
  linkCounterRentalOrder,
  recordCounterRentalCardSighting,
  releaseCounterRental,
  returnCounterRental,
} from "./gear-counter-rentals";
import {
  heldBy,
  insertShop,
  lend,
  person,
  rentalShop,
  rented,
  staffer,
  TODAY,
  unit,
} from "./gear-counter-rentals-test-fixtures";
import {
  certifications,
  type GearItemKindValue,
  orders,
  people,
  personRoles,
  specialtyCertifications,
  userAccounts,
} from "./schema";
import { createTrip } from "./trips-create";
import {
  completeWaiver,
  issueWaiverRequest,
  recordInPersonWaiver,
  recordMedicalEvaluation,
  retireMedicalRefusal,
  saveWaiverTemplate,
} from "./waivers";

// ---------------------------------------------------------------------------
// The counter's safety rules (dive-domain review of PR #2256)
// ---------------------------------------------------------------------------

describe("the card rule: life support needs a verified card", () => {
  it("refuses a regulator to somebody with no card at all, and writes nothing", async () => {
    const { db, shop } = await rentalShop();
    const walkIn = await person(db, shop.id, "No Card", undefined, { card: false });
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    const fins = await unit(db, shop.id, "Fins #1", "fins");
    expect(await lend(db, shop.id, walkIn.id, [fins.id, reg.id])).toEqual({
      ok: false,
      reason: "not_certified",
    });
    expect(await heldBy(db, walkIn.id)).toEqual([]);
  });

  it("refuses a regulator to somebody who declared they hold no certification", async () => {
    const { db, shop } = await rentalShop();
    const declared = await person(db, shop.id, "Declared None", undefined, { card: false });
    await db
      .update(people)
      .set({ noCertificationDeclaredAt: new Date("2026-10-01T12:00:00Z") })
      .where(eq(people.id, declared.id));
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    expect(await lend(db, shop.id, declared.id, [reg.id])).toEqual({
      ok: false,
      reason: "not_certified",
    });
  });

  it("refuses a regulator on a self-declared card, or one still waiting for review", async () => {
    const { db, shop } = await rentalShop();
    const claimed = await person(db, shop.id, "Says Advanced", undefined, { card: false });
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: claimed.id,
      agency: "padi",
      level: "advanced_open_water",
      selfDeclaredAt: new Date("2026-10-01T12:00:00Z"),
      status: "pending",
    });
    const captured = await person(db, shop.id, "Card Pending", undefined, { card: false });
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: captured.id,
      agency: "ssi",
      level: "open_water",
      identifier: "SSI-PENDING-1",
      status: "pending",
    });
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    const bcd = await unit(db, shop.id, "BCD #1");
    expect(await lend(db, shop.id, claimed.id, [reg.id])).toEqual({
      ok: false,
      reason: "not_certified",
    });
    expect(await lend(db, shop.id, captured.id, [bcd.id])).toEqual({
      ok: false,
      reason: "not_certified",
    });
  });

  it("refuses every life-support kind and lends soft goods to anybody", async () => {
    const { db, shop } = await rentalShop();
    const walkIn = await person(db, shop.id, "Snorkeler", undefined, { card: false });
    const lifeSupport: GearItemKindValue[] = [
      "regulator",
      "bcd",
      "tank",
      "dive_computer",
      "drysuit",
      "dpv",
      "o2_kit",
      "nitrox_analyzer",
    ];
    for (const kind of lifeSupport) {
      const item = await unit(db, shop.id, `LS ${kind}`, kind);
      expect(await lend(db, shop.id, walkIn.id, [item.id])).toEqual({
        ok: false,
        reason: "not_certified",
      });
    }
    const soft = await Promise.all(
      (["mask", "fins", "wetsuit", "torch", "weights"] as const).map((kind) =>
        unit(db, shop.id, `Soft ${kind}`, kind),
      ),
    );
    rented(
      await lend(
        db,
        shop.id,
        walkIn.id,
        soft.map((item) => item.id),
      ),
    );
    expect(await heldBy(db, walkIn.id)).toHaveLength(soft.length);
  });

  it("wants the drysuit card for a drysuit, on top of a verified level", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Open Water Only");
    const suit = await unit(db, shop.id, "Drysuit #1", "drysuit");
    expect(await lend(db, shop.id, diver.id, [suit.id])).toEqual({
      ok: false,
      reason: "no_drysuit_card",
    });
    // A self-declared drysuit card is somebody's word, and clears nothing.
    await db.insert(specialtyCertifications).values({
      shopId: shop.id,
      personId: diver.id,
      agency: "padi",
      specialty: "drysuit",
      selfDeclaredAt: new Date("2026-10-01T12:00:00Z"),
      status: "pending",
    });
    expect(await lend(db, shop.id, diver.id, [suit.id])).toEqual({
      ok: false,
      reason: "no_drysuit_card",
    });
    const dana = await staffer(db, shop.id);
    expect(
      await recordCounterRentalCardSighting(db, {
        shopId: shop.id,
        personId: diver.id,
        seenByPersonId: dana.id,
        agency: "padi",
        identifier: "DRY-12345",
        sighting: { card: "drysuit" },
      }),
    ).toEqual({ ok: true });
    rented(await lend(db, shop.id, diver.id, [suit.id]));
  });

  it("lends once a staffer records the card they saw, and the card says who saw it", async () => {
    const { db, shop } = await rentalShop();
    const walkIn = await person(db, shop.id, "Card In Hand", undefined, { card: false });
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    const dana = await staffer(db, shop.id);
    expect(await lend(db, shop.id, walkIn.id, [reg.id])).toMatchObject({ ok: false });

    expect(
      await recordCounterRentalCardSighting(db, {
        shopId: shop.id,
        personId: walkIn.id,
        seenByPersonId: dana.id,
        agency: "padi",
        identifier: "PADI-998877",
        sighting: { card: "level", level: "open_water" },
      }),
    ).toEqual({ ok: true });
    const [card] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, walkIn.id));
    expect(card).toMatchObject({ status: "verified", reviewedByPersonId: dana.id });
    expect(card?.reviewedAt).toBeInstanceOf(Date);

    rented(await lend(db, shop.id, walkIn.id, [reg.id]));
  });

  it("records no sighting for somebody who is not live staff, or for a card already on file", async () => {
    const { db, shop } = await rentalShop();
    const walkIn = await person(db, shop.id, "Card In Hand", undefined, { card: false });
    const notStaff = await person(db, shop.id, "Another Diver");
    const dana = await staffer(db, shop.id);
    const sighting = {
      shopId: shop.id,
      personId: walkIn.id,
      agency: "padi" as const,
      identifier: "PADI-555",
      sighting: { card: "level" as const, level: "open_water" as const },
    };
    expect(
      await recordCounterRentalCardSighting(db, { ...sighting, seenByPersonId: notStaff.id }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    expect(await lend(db, shop.id, walkIn.id, [reg.id])).toMatchObject({
      reason: "not_certified",
    });
    // The pending row that refusal left is the same card: a second try is a
    // duplicate, confirmed on the diver record rather than split in two.
    expect(
      await recordCounterRentalCardSighting(db, { ...sighting, seenByPersonId: dana.id }),
    ).toEqual({ ok: false, reason: "duplicate_card" });
  });
});

describe("the service screen: the one place a clock gates", () => {
  it("refuses life support whose clock runs out by the window's last day", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Ana Walk-In");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    expect(
      (
        await recordGearService(db, {
          shopId: shop.id,
          gearItemId: reg.id,
          kind: "service",
          servicedOn: "2025-10-09",
          nextDueOn: "2026-10-09",
        })
      ).ok,
    ).toBe(true);
    // Overdue on the 10th, the last day of this window.
    expect(await lend(db, shop.id, diver.id, [reg.id], { reservedUntil: "2026-10-10" })).toEqual({
      ok: false,
      reason: "unit_needs_service",
      unitId: reg.id,
    });
    // Confirming does nothing for life support.
    expect(
      await lend(db, shop.id, diver.id, [reg.id], {
        reservedUntil: "2026-10-10",
        confirmedFlaggedIds: [reg.id],
      }),
    ).toMatchObject({ reason: "unit_needs_service" });
    // Back before the clock runs out: lent.
    rented(await lend(db, shop.id, diver.id, [reg.id]));
  });

  it("refuses life support with an open concern, and lends flagged soft goods only when confirmed", async () => {
    const { db, shop } = await rentalShop();
    const first = await person(db, shop.id, "First Renter");
    const next = await person(db, shop.id, "Next Renter");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    const fins = await unit(db, shop.id, "Fins #1", "fins");
    const out = rented(await lend(db, shop.id, first.id, [reg.id, fins.id]));
    const ticket = { shopId: shop.id, ticketId: out.ticketId };
    await checkOutCounterRental(db, ticket);
    expect(
      await returnCounterRental(db, {
        ...ticket,
        outcome: "service_concern",
        note: "Free-flowed on the surface",
      }),
    ).toEqual({ ok: true, pulled: 0 });

    expect(await lend(db, shop.id, next.id, [reg.id])).toEqual({
      ok: false,
      reason: "unit_needs_service",
      unitId: reg.id,
    });
    expect(await lend(db, shop.id, next.id, [fins.id])).toEqual({
      ok: false,
      reason: "unit_needs_confirm",
      unitId: fins.id,
    });
    expect(await heldBy(db, next.id)).toEqual([]);
    rented(await lend(db, shop.id, next.id, [fins.id], { confirmedFlaggedIds: [fins.id] }));
  });
});

describe("dives on a counter rental", () => {
  it("counts the dives said at the return on the unit's dive clock, and nothing when unsaid", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Ana Walk-In");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    const other = await unit(db, shop.id, "Reg #2", "regulator");
    for (const item of [reg, other]) {
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: item.id,
        kind: "service",
        servicedOn: "2026-10-01",
        nextDueOn: "2027-10-01",
        nextDueDives: 100,
      });
    }
    const counted = rented(await lend(db, shop.id, diver.id, [reg.id]));
    await checkOutCounterRental(db, { shopId: shop.id, ticketId: counted.ticketId });
    await returnCounterRental(db, {
      shopId: shop.id,
      ticketId: counted.ticketId,
      outcome: "all_good",
      dives: 4,
    });
    const unsaid = rented(await lend(db, shop.id, diver.id, [other.id]));
    await checkOutCounterRental(db, { shopId: shop.id, ticketId: unsaid.ticketId });
    await returnCounterRental(db, {
      shopId: shop.id,
      ticketId: unsaid.ticketId,
      outcome: "all_good",
    });

    const clocks = await latestServiceClocks(db, shop.id, [reg.id, other.id]);
    expect(clocks.get(reg.id)?.[0]?.divesSince).toBe(4);
    expect(clocks.get(other.id)?.[0]?.divesSince).toBe(0);
  });
});

describe("releasing an invoiced rental", () => {
  it("is refused while an invoice points at it, and the rows stay", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Ana Walk-In", "ana@example.com");
    const bcd = await unit(db, shop.id, "BCD #1");
    const rental = rented(await lend(db, shop.id, diver.id, [bcd.id]));
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: diver.id,
        createdByPersonId: diver.id,
        currency: "usd",
        totalCents: 1500,
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_release",
        stripeInvoiceId: "in_release",
      })
      .returning();
    if (!order) throw new Error("order insert failed");
    await linkCounterRentalOrder(db, {
      shopId: shop.id,
      reservationIds: rental.reservationIds,
      orderId: order.id,
    });
    const desk = await staffer(db, shop.id);
    expect(
      await releaseCounterRental(db, {
        shopId: shop.id,
        ticketId: rental.ticketId,
        releasedByPersonId: desk.id,
      }),
    ).toEqual({
      ok: false,
      reason: "invoiced",
    });
    expect(await heldBy(db, diver.id)).toHaveLength(1);
  });
});

describe("counter rentals over a departure's window", () => {
  it("names what a diver still holds across the window, and nothing returned or outside it", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Ana Walk-In");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    const fins = await unit(db, shop.id, "Fins #1", "fins");
    rented(await lend(db, shop.id, diver.id, [reg.id], { reservedUntil: "2026-10-10" }));
    // A rental is its insert's stamp, so the second one is made a moment later.
    advanceClock();
    const back = rented(await lend(db, shop.id, diver.id, [fins.id]));
    await checkOutCounterRental(db, { shopId: shop.id, ticketId: back.ticketId });
    await returnCounterRental(db, {
      shopId: shop.id,
      ticketId: back.ticketId,
      outcome: "all_good",
    });

    const during = await counterRentalsHeldDuring(db, shop.id, [diver.id], {
      from: "2026-10-10",
      until: "2026-10-10",
    });
    expect(during.get(diver.id)).toEqual([{ label: "Reg #1", until: "2026-10-10" }]);
    const after = await counterRentalsHeldDuring(db, shop.id, [diver.id], {
      from: "2026-10-11",
      until: "2026-10-11",
    });
    expect(after.size).toBe(0);
    const rival = await insertShop(db, "rival-held");
    expect(
      (
        await counterRentalsHeldDuring(db, rival.id, [diver.id], {
          from: TODAY,
          until: "2026-10-10",
        })
      ).size,
    ).toBe(0);
  });
});

/**
 * **The person's waiver at the counter** (issue #2261, H-108): the ticket and
 * the Rentals list say where the release stands, and the rental never waits
 * on it. Read off the person, because a release is signed once and belongs to
 * them, not to a booking.
 */
describe("counterRentalWaiverStandings", () => {
  async function staffer(db: AppDb, shopId: string) {
    const [row] = await db.insert(people).values({ shopId, fullName: "Desk Staffer" }).returning();
    if (!row) throw new Error("staff insert failed");
    await db.insert(personRoles).values({ personId: row.id, role: "owner" });
    await db.insert(userAccounts).values({
      personId: row.id,
      email: `desk.${row.id.slice(0, 8)}@example.com`,
      hashedPassword: "x",
      status: "active",
    });
    return row;
  }

  it("says a never-signed person has no waiver, and the rental goes out anyway", async () => {
    const { db, shop } = await rentalShop();
    await saveWaiverTemplate(db, { shopId: shop.id, title: "Release", body: "The terms." });
    const ana = await person(db, shop.id, "Ana Walk-In");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");

    // Life support, no waiver: informs, never gates.
    rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [reg.id],
        reservedFrom: TODAY,
        reservedUntil: TODAY,
        todayLocal: TODAY,
      }),
    );
    const standings = await counterRentalWaiverStandings(db, {
      shopId: shop.id,
      timezone: shop.timezone,
      personIds: [ana.id],
    });
    expect(standings.get(ana.id)?.state).toBe("none");
    expect(counterRentalWaiverFlag("none")).toEqual({ offerLink: true });
  });

  it("reads a release the person signed, with no booking anywhere", async () => {
    const { db, shop } = await rentalShop();
    await saveWaiverTemplate(db, { shopId: shop.id, title: "Release", body: "The terms." });
    const ana = await person(db, shop.id, "Ana Walk-In");
    const desk = await staffer(db, shop.id);
    const signed = await recordInPersonWaiver(db, {
      shopId: shop.id,
      subject: { personId: ana.id },
      recordedByPersonId: desk.id,
      medicalAttested: true,
    });
    expect(signed).toMatchObject({ ok: true });

    const standings = await counterRentalWaiverStandings(db, {
      shopId: shop.id,
      timezone: shop.timezone,
      personIds: [ana.id],
    });
    expect(standings.get(ana.id)?.state).toBe("current");
    expect(counterRentalWaiverFlag("current")).toBeNull();
  });

  /**
   * H-98 as amended (issues #2158, #2195): a later clean release stands over a
   * physician's "not cleared", as a warning. The counter carries the medical
   * mark so the new-rental form and the ticket can say it, never gate on it.
   */
  it("carries a physician's earlier refusal under a later clean release", async () => {
    const { db, shop } = await rentalShop();
    await saveWaiverTemplate(db, { shopId: shop.id, title: "Release", body: "The terms." });
    const desk = await staffer(db, shop.id);
    const startsAt = new Date(nowMs() + 3 * 24 * 3_600_000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 6,
    });
    if (!trip) throw new Error("trip insert failed");
    const booking = await createBooking(db, {
      shopId: shop.id,
      tripId: trip.id,
      actor: "staff",
      fullName: "Rafa Referred",
      email: "rafa@example.com",
    });
    if (!booking.ok) throw new Error("booking failed");
    const clear = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
    const referral = { ...clear, responses: { ...clear.responses, q3: true } };
    const t0 = nowMs() - 3 * 3_600_000;

    const first = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.bookingId,
      now: new Date(t0),
    });
    if (!first.ok) throw new Error(`link refused: ${first.reason}`);
    await completeWaiver(db, first.token, {
      signerName: "Rafa Referred",
      agreed: true,
      medicalAnswers: referral,
      now: new Date(t0),
    });
    await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      timeZone: shop.timezone,
      personId: booking.personId,
      recordedByPersonId: desk.id,
      evaluatedOn: calendarDateInTimezone(new Date(t0), shop.timezone),
      physicianName: "Dr. Imani Reyes",
      now: new Date(t0 + 60_000),
    });
    await retireMedicalRefusal(db, {
      shopId: shop.id,
      bookingId: booking.bookingId,
      actorPersonId: desk.id,
      now: new Date(t0 + 120_000),
    });
    const fresh = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.bookingId,
      now: new Date(t0 + 120_000),
    });
    if (!fresh.ok) throw new Error(`fresh link refused: ${fresh.reason}`);
    await completeWaiver(db, fresh.token, {
      signerName: "Rafa Referred",
      agreed: true,
      medicalAnswers: clear,
      now: new Date(t0 + 180_000),
    });

    const standing = (
      await counterRentalWaiverStandings(db, {
        shopId: shop.id,
        timezone: shop.timezone,
        personIds: [booking.personId],
      })
    ).get(booking.personId);
    expect(standing?.state).toBe("current");
    expect(standing?.state === "current" ? standing.medical?.overriddenRefusal : null).toEqual(
      expect.objectContaining({ recordId: expect.any(String) }),
    );
  });

  it("answers nothing for another shop's person", async () => {
    const { db, shop } = await rentalShop();
    const other = await insertShop(db, "other-counter");
    const stranger = await person(db, other.id, "Somebody Else");
    const standings = await counterRentalWaiverStandings(db, {
      shopId: shop.id,
      timezone: shop.timezone,
      personIds: [stranger.id],
    });
    expect(standings.has(stranger.id)).toBe(false);
  });

  it("answers nothing for a deleted person, so no send is offered that would fail", async () => {
    const { db, shop } = await rentalShop();
    const gone = await person(db, shop.id, "Gone Diver");
    await db
      .update(people)
      .set({ deletedAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(people.id, gone.id));
    const standings = await counterRentalWaiverStandings(db, {
      shopId: shop.id,
      timezone: shop.timezone,
      personIds: [gone.id],
    });
    expect(standings.has(gone.id)).toBe(false);
  });
});
