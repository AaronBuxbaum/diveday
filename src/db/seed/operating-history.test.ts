import { and, asc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fareCheckout } from "../checkout-purpose";
import { listTripReadiness } from "../readiness";
import {
  boats,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  cards,
  collectionEntries,
  diveSites,
  executedDives,
  gearItems,
  gearReservations,
  interestReplies,
  interests,
  orderLineItems,
  orders,
  people,
  preDepartureCheckEvents,
  recapPulses,
  rentalFitProfiles,
  rollCallEvents,
  tripAssignments,
  tripDives,
  tripSightings,
  trips,
  waiverRecords,
  waiverTemplates,
} from "../schema";
import { DEMO_COMPLETED_TRIP_TITLE } from "./more-trips";

const ctx = fileScopedShopContext({ history: true });
const historyDescription = "Sailed. Kept in the log for the shop's monthly numbers.";

describe("a shop with an operating history", () => {
  it("keeps the planned sites, completed dives, checklist, and crew counts together", async () => {
    const { db, shop } = ctx;
    const history = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.description, historyDescription)));
    expect(history.length).toBeGreaterThan(20);
    const plans = await db
      .select({
        tripId: tripDives.tripId,
        number: tripDives.diveNumber,
        site: diveSites.name,
        createdAt: tripDives.createdAt,
        siteCreated: diveSites.createdAt,
      })
      .from(tripDives)
      .innerJoin(diveSites, eq(diveSites.id, tripDives.diveSiteId));
    const logged = await db.select().from(executedDives).where(eq(executedDives.shopId, shop.id));
    const checks = await db
      .select()
      .from(preDepartureCheckEvents)
      .where(eq(preDepartureCheckEvents.shopId, shop.id));
    const crew = await db.select().from(tripAssignments);
    const hulls = await db.select().from(boats).where(eq(boats.shopId, shop.id));
    const staff = await db.select().from(people).where(eq(people.shopId, shop.id));
    const counts = await db
      .select()
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.shopId, shop.id), eq(rollCallEvents.subjectKind, "crew")));
    for (const trip of history) {
      const dives = logged.filter((dive) => dive.tripId === trip.id);
      expect(dives.length, trip.title).toBe(trip.plannedDives);
      for (const dive of dives) {
        expect(dive.actualSiteId).toBeTruthy();
        if (!dive.enteredAt || !dive.exitedAt)
          throw new Error("a logged dive is missing its times");
        expect(dive.enteredAt.getTime()).toBeGreaterThan(trip.startsAt.getTime());
        expect(dive.exitedAt.getTime()).toBeLessThan(
          trip.startsAt.getTime() + dive.diveNumber * 90 * 60_000,
        );
        expect(dive.exitedAt.getTime()).toBeLessThan(trip.endsAt.getTime());
      }
      expect(
        checks.filter((check) => check.tripId === trip.id && check.status === "checked").length,
      ).toBe(5);
      expect(
        checks
          .filter((check) => check.tripId === trip.id)
          .every((check) => check.createdAt.getTime() === check.occurredAt.getTime()),
      ).toBe(true);
      expect(
        plans
          .filter((plan) => plan.tripId === trip.id)
          .every((plan) => plan.createdAt <= trip.startsAt && plan.siteCreated <= plan.createdAt),
      ).toBe(true);
      expect(
        hulls.some((boat) => boat.id === trip.boatId && boat.createdAt <= trip.createdAt),
      ).toBe(true);
      for (const member of crew.filter((row) => row.tripId === trip.id)) {
        const marks = counts.filter(
          (count) =>
            count.tripId === trip.id &&
            count.crewPersonId === member.personId &&
            count.status === "boarded",
        );
        expect(marks.length).toBe(trip.plannedDives + 1);
        expect(marks.every((mark) => mark.createdAt.getTime() === mark.occurredAt.getTime())).toBe(
          true,
        );
        expect(
          marks.find((mark) => mark.checkpoint === "departure")?.credentialSnapshot?.length,
        ).toBeGreaterThan(0);
        expect(
          marks
            .filter((mark) => mark.checkpoint !== "departure")
            .every((mark) => mark.credentialSnapshot === null),
        ).toBe(true);
        expect(
          staff.some(
            (person) => person.id === member.personId && person.createdAt <= trip.createdAt,
          ),
        ).toBe(true);
      }
    }
    const twoSites = history.find((trip) => trip.title === "Two-Tank Reef — Molasses & French");
    if (!twoSites) throw new Error("the Molasses and French departure is missing");
    expect(
      plans
        .filter((plan) => plan.tripId === twoSites.id)
        .sort((a, b) => a.number - b.number)
        .map((plan) => plan.site),
    ).toEqual(["Molasses Reef", "French Reef"]);
    const sightings = await db
      .select()
      .from(tripSightings)
      .where(eq(tripSightings.shopId, shop.id));
    for (const sighting of sightings) {
      const matching = logged.filter(
        (dive) => dive.tripId === sighting.tripId && dive.actualSiteId === sighting.diveSiteId,
      );
      expect(matching.some((dive) => dive.exitedAt && dive.exitedAt <= sighting.recordedAt)).toBe(
        true,
      );
      expect(
        crew.some(
          (member) =>
            member.tripId === sighting.tripId && member.personId === sighting.recordedByPersonId,
        ),
      ).toBe(true);
    }
  });

  it("has returned gear tied to real past seats, without leaving units out", async () => {
    const { db, shop } = ctx;
    const rows = await db
      .select({
        reservation: gearReservations,
        trip: trips,
        status: bookings.status,
        gearCreated: gearItems.createdAt,
        fit: rentalFitProfiles,
      })
      .from(gearReservations)
      .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(gearItems, eq(gearItems.id, gearReservations.gearItemId))
      .leftJoin(rentalFitProfiles, eq(rentalFitProfiles.personId, bookings.personId))
      .where(
        and(
          eq(gearReservations.shopId, shop.id),
          isNotNull(gearReservations.returnedAt),
          lt(trips.endsAt, nowDate()),
        ),
      );
    expect(rows.length).toBeGreaterThan(20);
    for (const { reservation, trip, status, gearCreated, fit } of rows) {
      expect(status).toBe("booked");
      if (!reservation.checkedOutAt || !reservation.returnedAt)
        throw new Error("rental has no handover or return");
      expect(reservation.checkedOutAt.getTime()).toBeLessThan(trip.startsAt.getTime());
      expect(reservation.createdAt <= reservation.checkedOutAt).toBe(true);
      expect(reservation.returnedAt.getTime()).toBeGreaterThan(trip.endsAt.getTime());
      expect(reservation.returnedAt.getTime()).toBeLessThan(nowDate().getTime());
      expect(gearCreated <= reservation.checkedOutAt).toBe(true);
      // Generic historic assignments are made only where no saved fit exists.
      expect(fit).toBeNull();
    }
    const tanks = await db
      .select({ id: gearItems.id })
      .from(gearItems)
      .where(and(eq(gearItems.shopId, shop.id), eq(gearItems.kind, "tank")));
    expect(tanks.length).toBeGreaterThanOrEqual(70);
    const mismatchedStock = await db
      .select()
      .from(gearItems)
      .where(
        and(
          eq(gearItems.shopId, shop.id),
          or(
            and(eq(gearItems.kind, "boots"), eq(gearItems.size, "12")),
            and(eq(gearItems.kind, "fins"), eq(gearItems.size, "XL")),
          ),
        ),
      );
    expect(mismatchedStock).toEqual([]);
  });

  it("shows current divers returning, with profiles and cards predating their visits", async () => {
    const { db, shop } = ctx;
    const rows = await db
      .select({ person: people, booking: bookings, trip: trips })
      .from(people)
      .innerJoin(bookings, eq(bookings.personId, people.id))
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(people.shopId, shop.id),
          inArray(people.fullName, ["Diego Alvarez", "June Park", "Omar Haddad"]),
        ),
      );
    for (const name of ["Diego Alvarez", "June Park", "Omar Haddad"]) {
      const visits = rows.filter((row) => row.person.fullName === name);
      const pastVisits = visits.filter((row) => row.trip.description === historyDescription);
      expect(pastVisits.length).toBeGreaterThanOrEqual(2);
      expect(visits.some((row) => row.trip.startsAt > nowDate())).toBe(true);
      expect(
        visits.every(
          (row) =>
            row.person.createdAt <= row.booking.createdAt &&
            row.trip.createdAt <= row.booking.createdAt,
        ),
      ).toBe(true);
      const firstVisit = visits[0];
      if (!firstVisit) throw new Error(`no visits for ${name}`);
      const evidence = await db
        .select()
        .from(cards)
        .where(and(eq(cards.personId, firstVisit.person.id), eq(cards.kind, "level")));
      expect(evidence.length).toBeGreaterThan(0);
      expect(evidence.every((card) => card.reviewedAt && card.createdAt <= card.reviewedAt)).toBe(
        true,
      );
      for (const visit of pastVisits) {
        const readiness = await listTripReadiness(db, shop.id, visit.trip.id, visit.trip.startsAt);
        expect(readiness.find((row) => row.booking.id === visit.booking.id)?.readiness.status).toBe(
          "ready",
        );
      }
    }
  });

  it("uses the release version in effect whenever a diver signed", async () => {
    const { db, shop } = ctx;
    const signed = await db
      .select({ record: waiverRecords, template: waiverTemplates })
      .from(waiverRecords)
      .innerJoin(waiverTemplates, eq(waiverTemplates.id, waiverRecords.templateId))
      .where(and(eq(waiverRecords.shopId, shop.id), isNotNull(waiverRecords.signedAt)));
    expect(signed.length).toBeGreaterThan(100);
    const templates = await db
      .select()
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shop.id));
    for (const { record, template } of signed) {
      const signedAt = record.signedAt;
      if (!signedAt) throw new Error("release missing signature");
      expect(template.createdAt <= signedAt).toBe(true);
      expect(
        templates
          .filter((candidate) => candidate.createdAt <= signedAt)
          .every((candidate) => candidate.version <= template.version),
      ).toBe(true);
      expect(record.templateVersion).toBe(template.version);
      expect(record.templateBody).toBe(template.body);
    }
  });

  it("keeps answered requests and addressed private feedback linked to their source", async () => {
    const { db, shop } = ctx;
    const replies = await db
      .select({ reply: interestReplies, request: interests })
      .from(interestReplies)
      .innerJoin(interests, eq(interests.id, interestReplies.interestId))
      .where(eq(interestReplies.shopId, shop.id));
    expect(
      replies.some(
        ({ reply, request }) =>
          reply.status === "sent" &&
          request.closedAs === "replied" &&
          reply.sentAt >= request.askedAt,
      ),
    ).toBe(true);
    const pulses = await db
      .select({ pulse: recapPulses, booking: bookings })
      .from(recapPulses)
      .innerJoin(bookings, eq(bookings.id, recapPulses.bookingId))
      .where(eq(recapPulses.shopId, shop.id));
    expect(pulses.length).toBeGreaterThanOrEqual(2);
    expect(
      pulses.every(
        ({ pulse, booking }) =>
          pulse.personId === booking.personId &&
          pulse.tripId === booking.tripId &&
          pulse.addressedAt &&
          pulse.addressedAt >= pulse.createdAt,
      ),
    ).toBe(true);
  });

  it("records received order amounts once, with dated reversals and local receipts", async () => {
    const { db, shop } = ctx;
    const receipts = await db.select().from(orders).where(eq(orders.shopId, shop.id));
    const ledger = await db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.shopId, shop.id))
      .orderBy(asc(collectionEntries.id));
    expect(ledger.length).toBeGreaterThan(100);
    const paid = receipts.find(
      (order) =>
        order.stripeInvoiceId?.startsWith(`in_demo_${shop.id}_`) &&
        order.status === "paid" &&
        order.bookingId,
    );
    if (!paid?.paidAt) throw new Error("no paid historical invoice");
    const entries = ledger.filter(
      (entry) => entry.sourceType === "order" && entry.sourceId === paid.id,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amountCents).toBe(paid.amountPaidCents - paid.taxCents);
    expect(entries[0]?.recordedAt.getTime()).toBe(paid.paidAt.getTime());
    const reversal = ledger.find((entry) => entry.amountCents < 0);
    if (!reversal) throw new Error("no collection reversal");
    expect(
      ledger.some(
        (entry) => entry.id === reversal.reversesEntryId && entry.sourceId === reversal.sourceId,
      ),
    ).toBe(true);
    const walkIn = receipts.find((order) => order.personId === null && order.collection === "cash");
    if (!walkIn) throw new Error("no walk-in receipt");
    expect(walkIn?.counterReceipt?.taxKnown).toBe(true);
    expect(
      (await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, walkIn.id))).length,
    ).toBeGreaterThan(0);

    const [promo] = await db
      .select({ checkout: bookingCheckouts, bookingId: bookingCheckoutBookings.bookingId })
      .from(bookingCheckouts)
      .innerJoin(
        bookingCheckoutBookings,
        eq(bookingCheckoutBookings.checkoutId, bookingCheckouts.id),
      )
      .where(
        and(
          eq(bookingCheckouts.shopId, shop.id),
          fareCheckout(),
          eq(bookingCheckouts.status, "completed"),
        ),
      );
    if (!promo) throw new Error("no completed fare checkout");
    const [promoPayment] = await db
      .select()
      .from(bookingPayments)
      .where(
        and(eq(bookingPayments.shopId, shop.id), eq(bookingPayments.bookingId, promo.bookingId)),
      );
    expect(promoPayment?.provider).toBe("stripe");
    expect(promoPayment?.amountCents).toBe(promo.checkout.settledTotalCents);
    expect(
      ledger.filter(
        (entry) => entry.sourceType === "checkout" && entry.sourceId === promo.checkout.id,
      ),
    ).toHaveLength(1);
    expect(
      ledger.some((entry) => entry.sourceType === "booking" && entry.sourceId === promo.bookingId),
    ).toBe(false);

    const [dawn] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, DEMO_COMPLETED_TRIP_TITLE)));
    if (!dawn) throw new Error("no dawn departure");
    const dawnBoarded = await db
      .select({ bookedAt: bookings.createdAt })
      .from(bookings)
      .innerJoin(
        rollCallEvents,
        and(
          eq(rollCallEvents.bookingId, bookings.id),
          eq(rollCallEvents.subjectKind, "seat"),
          eq(rollCallEvents.checkpoint, "departure"),
          eq(rollCallEvents.status, "boarded"),
        ),
      )
      .where(and(eq(bookings.shopId, shop.id), eq(bookings.tripId, dawn.id)));
    expect(
      dawnBoarded.every((seat) => dawn.createdAt <= seat.bookedAt && seat.bookedAt < dawn.startsAt),
    ).toBe(true);
    const dawnWaivers = await db
      .select({ bookedAt: bookings.createdAt, createdAt: waiverRecords.createdAt })
      .from(waiverRecords)
      .innerJoin(bookings, eq(bookings.id, waiverRecords.bookingId))
      .where(and(eq(bookings.shopId, shop.id), eq(bookings.tripId, dawn.id)));
    expect(dawnWaivers.length).toBeGreaterThan(0);
    expect(dawnWaivers.filter((waiver) => waiver.bookedAt > waiver.createdAt)).toEqual([]);
    const dawnSeats = await db
      .select({
        bookingId: bookings.id,
        bookedAt: bookings.createdAt,
        personCreatedAt: people.createdAt,
        paidAt: bookingPayments.updatedAt,
        method: bookingPayments.method,
        amountCents: bookingPayments.amountCents,
      })
      .from(bookings)
      .innerJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(bookings.shopId, shop.id),
          eq(bookings.tripId, dawn.id),
          eq(bookingPayments.status, "paid"),
        ),
      );
    expect(dawnSeats.length).toBeGreaterThanOrEqual(6);
    for (const seat of dawnSeats) {
      expect(seat.method).toBe("cash");
      expect(dawn.createdAt <= seat.bookedAt).toBe(true);
      expect(seat.personCreatedAt <= seat.bookedAt).toBe(true);
      expect(seat.bookedAt <= seat.paidAt && seat.paidAt < dawn.startsAt).toBe(true);
      expect(
        ledger.filter(
          (entry) =>
            entry.sourceType === "booking" &&
            entry.sourceId === seat.bookingId &&
            entry.amountCents === seat.amountCents,
        ),
      ).toHaveLength(1);
    }
  });
});
