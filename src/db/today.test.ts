// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { CreateTripPromotionResult, PromotionProvider } from "@/lib/payments/promotions";
import { seededShopContext } from "@/test/db";
import { cancelBooking } from "./bookings";
import { joinLastMinuteList } from "./last-minute-list";
import { getTripManifest, recordRollCall } from "./manifests";
import { setBookingNitrox } from "./nitrox";
import { recordNotificationDelivery } from "./notifications";
import { saveRentalFit } from "./rental-fit";
import { nitroxCertifications, people, tripWaitlistEntries } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getTodayWork } from "./today";
import { sendLastMinuteDealBlast } from "./trip-promos";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

function fakePromotions(): PromotionProvider {
  return {
    async createTripPromotion(): Promise<CreateTripPromotionResult> {
      return { status: "created", stripeCouponId: "coupon_1", stripePromotionCodeId: "promo_1" };
    },
    async createShopPromotion(): Promise<CreateTripPromotionResult> {
      return { status: "created", stripeCouponId: "coupon_1", stripePromotionCodeId: "promo_1" };
    },
  };
}

const clearAnswers = { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} };

describe("today's work queue (in-memory PGlite)", () => {
  it("puts the seeded departure that sails today on the board with live readiness counts", async () => {
    const { db, shop } = await seededShopContext();

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(work.departures).toHaveLength(1);
    const [departure] = work.departures;
    expect(departure?.title).toBe("Two-Tank Reef — Molasses & French");
    expect(departure?.booked).toBe(9);
    expect(departure?.capacity).toBe(12);
    // Most divers have already signed their waiver in the fresh seed — only
    // the first-booked diver (the deliberate straggler) is still blocked.
    expect(departure?.ready).toBe(8);
    expect(departure?.blocked).toBe(1);
    expect(departure?.boarded).toBe(0);
    expect(work.nextDeparture).toBeNull();
  });

  it("collapses a boat's identical blockers so one busy trip cannot bury the rest", async () => {
    const { db, shop } = await seededShopContext();

    // Today's reef trip is mostly ready these days (only one straggler left);
    // the wreck charter five days out is the boat still carrying a pile of
    // divers who share the same blocker (short of the AOW + Deep + nitrox the
    // charter requires) — exactly the "one busy trip" scenario this collapses.
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const wreck = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
    if (!wreck) throw new Error("demo wreck trip missing");
    const manifest = await getTripManifest(db, shop.id, wreck.id);
    if (!manifest) throw new Error("expected wreck manifest");
    const wreckBlocked = manifest.divers.filter(
      (diver) => diver.readiness.status !== "ready",
    ).length;

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    // Scoped to the wreck boat: the shop has other trips on the books, and
    // their blockers are their own rows. What must not happen is this boat's
    // blocked divers each claiming a line of the queue.
    const blockerRows = work.actions.filter((action) =>
      action.id.startsWith(`blockers:${wreck.id}:`),
    );

    expect(wreckBlocked).toBeGreaterThan(1);
    expect(blockerRows.length).toBeGreaterThan(0);
    expect(blockerRows.length).toBeLessThan(wreckBlocked);
    expect(new Set(blockerRows.map((action) => action.id)).size).toBe(blockerRows.length);
  });

  it("drops a diver out of the queue once their evidence clears", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, shop.id, reef.id);
    if (!entry) throw new Error("demo booking missing");

    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    // Every reef diver but the seed's first-booked one already has a waiver
    // issued (waiver_pending, collapsed into its own group row); that one
    // diver alone is genuinely unsent, so she gets a named row of her own
    // rather than joining a "N divers" group.
    const waiverRow = (work: Awaited<ReturnType<typeof getTodayWork>>) =>
      work.actions.find((action) => action.id === `blocker:${entry.booking.id}:waiver_not_sent`);
    expect(waiverRow(before)?.subject).toBe(entry.person.fullName);
    expect(waiverRow(before)?.detail).toBe("Waiver has not been sent.");

    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: entry.booking.id });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: entry.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(waiverRow(after)).toBeUndefined();
    // She was the boat's one remaining straggler — clearing her leaves the
    // whole roster ready.
    expect(after.departures[0]?.ready).toBe(9);
    expect(after.departures[0]?.blocked).toBe(0);
  });

  it("counts a boarded diver on today's board", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, shop.id, reef.id);
    const [staff] = await listStaff(db, shop.id);
    if (!entry || !staff) throw new Error("demo fixture missing");

    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: entry.booking.id });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: entry.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: entry.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(work.departures[0]?.boarded).toBe(1);
  });

  it("drops a cancelled booking from the boarded count, not just the booked count", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, shop.id, reef.id);
    const [staff] = await listStaff(db, shop.id);
    if (!entry || !staff) throw new Error("demo fixture missing");

    // Readiness gates boarding at the departure checkpoint, so this diver
    // needs a completed waiver before recordRollCall will accept "boarded"
    // (same setup as the "counts a boarded diver" test above).
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: entry.booking.id });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: entry.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: entry.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
    });
    const boarded = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(boarded.departures[0]?.booked).toBe(9);
    expect(boarded.departures[0]?.boarded).toBe(1);

    // A no-show pulled, or a refund, after the diver already boarded — the
    // roll-call event row stays in the table. Without the bookings join in
    // boardedCountsByTrip, this diver would still count as boarded even
    // though `booked` (upcomingTripsWithCounts) already excludes them —
    // letting the two totals coincidentally match while other divers on this
    // trip remain genuinely unboarded.
    await cancelBooking(db, shop.id, entry.booking.id);
    const afterCancel = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(afterCancel.departures[0]?.booked).toBe(8);
    expect(afterCancel.departures[0]?.boarded).toBe(0);
  });

  it("flags divers with no rental fit on file, and clears it once a fit is saved", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    if (roster.length === 0) throw new Error("demo bookings missing");

    const flagged = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const prepAction = flagged.actions.find((action) => action.id === `prep:${reef.id}`);
    expect(prepAction?.actionLabel).toBe("Open prep list");
    expect(prepAction?.href).toBe(`/shop/${shop.slug}/trips/${reef.id}/prep`);

    for (const entry of roster) {
      await saveRentalFit(db, {
        shopId: shop.id,
        personId: entry.person.id,
        rentsBcd: true,
        rentsRegulator: true,
        rentsWetsuit: true,
        rentsMaskFins: true,
        rentsWeights: true,
        rentsDiveComputer: false,
        rentsGopro: false,
        bcdSize: "M",
      });
    }

    const cleared = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(cleared.actions.some((action) => action.id === `prep:${reef.id}`)).toBe(false);
  });

  it("turns an email-delivery failure into a one-tap resend, not just a link", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, shop.id, reef.id);
    if (!entry) throw new Error("demo bookings missing");

    // A failed booking confirmation resends from stored data...
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      kind: "booking_confirmation",
      delivery: { status: "failed" },
    });
    const withConfirm = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const confirmRow = withConfirm.actions.find((action) => action.kind === "email_delivery");
    expect(confirmRow?.actionLabel).toBe("Resend confirmation");
    expect(confirmRow?.resend).toEqual({ bookingId: entry.booking.id });

    // ...while a failed waiver link reissues through the shared WP-1 send path.
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      kind: "waiver_request",
      delivery: { status: "failed" },
    });
    const withWaiver = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const waiverRow = withWaiver.actions.find(
      (action) => action.kind === "email_delivery" && action.waiver,
    );
    expect(waiverRow?.actionLabel).toBe("Resend waiver link");
    expect(waiverRow?.waiver).toEqual({ bookingIds: [entry.booking.id] });
  });

  it("makes a freed seat one-tap invitable, targeting the front of the wait list", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    // The seeded reef boat sails today at 9/12 — three open seats to fill.
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    expect(reef.booked).toBeLessThan(reef.capacity);

    const [front, later] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Marina Reyes", email: "marina@example.com" },
        { shopId: shop.id, fullName: "Theo Park", email: "theo@example.com" },
      ])
      .returning();
    if (!front || !later) throw new Error("could not seed waiters");
    // Explicit join times so the front of the line is deterministic.
    await db.insert(tripWaitlistEntries).values([
      {
        shopId: shop.id,
        tripId: reef.id,
        personId: front.id,
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
      },
      {
        shopId: shop.id,
        tripId: reef.id,
        personId: later.id,
        createdAt: new Date("2020-02-01T00:00:00.000Z"),
      },
    ]);
    const frontEntry = (
      await db
        .select()
        .from(tripWaitlistEntries)
        .where(
          and(eq(tripWaitlistEntries.tripId, reef.id), eq(tripWaitlistEntries.personId, front.id)),
        )
    )[0];
    if (!frontEntry) throw new Error("front entry missing");

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `waitlist:${reef.id}`);
    expect(row?.kind).toBe("waitlist_seat");
    // Depth is counted, but the invite targets the earliest joiner specifically.
    expect(row?.detail).toContain("2 people are on the wait list");
    expect(row?.invite).toBeDefined();
    expect(row?.invite?.entryId).toBe(frontEntry.id);
    expect(row?.invite?.personName).toBe("Marina Reyes");
    expect(row?.invite?.personEmail).toBe("marina@example.com");
    expect(row?.invite?.tripId).toBe(reef.id);
    expect(row?.invite?.bookingPath).toBe(`/shop/${shop.slug}/schedule/${reef.id}`);
  });

  it("nudges an under-capacity trip departing soon that has never had a last-minute deal sent", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `last-minute-fill:${reef.id}`);
    expect(row?.kind).toBe("last_minute_fill");
    expect(row?.detail).toContain(`${reef.capacity - reef.booked} seats open`);
  });

  it("stops nudging once a last-minute deal has actually been sent for that trip", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");

    await upsertShopStripeAccount(db, shop.id, "acct_today_test");
    await setShopStripeAccountStatus(db, "acct_today_test", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    const sent = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: shop.slug, tripId: reef.id, discountPercent: 25 },
      fakePromotions(),
    );
    expect(sent.ok).toBe(true);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(
      work.actions.find((action) => action.id === `last-minute-fill:${reef.id}`),
    ).toBeUndefined();
  });

  it("raises a nitrox request whose card stopped being verified", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    const certified = roster.find((entry) => entry.person.fullName === "Priya Sharma");
    if (!certified) throw new Error("seeded nitrox diver missing from the reef trip");

    const requested = await setBookingNitrox(db, {
      shopId: shop.id,
      bookingId: certified.booking.id,
      wantsNitrox: true,
    });
    expect(requested.ok).toBe(true);

    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(before.actions.some((action) => action.id === `nitrox:${reef.id}`)).toBe(false);

    // The card is pulled (archived) after the request was already accepted.
    await db
      .update(nitroxCertifications)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(nitroxCertifications.shopId, shop.id),
          eq(nitroxCertifications.personId, certified.person.id),
        ),
      );

    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const nitroxAction = after.actions.find((action) => action.id === `nitrox:${reef.id}`);
    expect(nitroxAction?.detail).toContain("without a verified card");
  });

  it("nudges staff about missing emergency contacts on a near boat, and clears once filled", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    if (roster.length === 0) throw new Error("demo bookings missing");
    // Strip any seeded contacts so today's whole boat is missing one.
    for (const entry of roster) {
      await db
        .update(people)
        .set({ emergencyContactName: null, emergencyContactPhone: null })
        .where(eq(people.id, entry.person.id));
    }

    const flagged = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const contactAction = flagged.actions.find((action) => action.id === `contact:${reef.id}`);
    expect(contactAction?.kind).toBe("emergency_contact");
    expect(contactAction?.detail).toContain("no emergency contact");
    // Never a boarding blocker; it points at the guests roster to settle at the counter.
    expect(contactAction?.href).toBe(`/shop/${shop.slug}/trips/${reef.id}/guests`);

    // A name with no phone is unreachable in an incident — still flagged.
    for (const entry of roster) {
      await db
        .update(people)
        .set({ emergencyContactName: "Kin Ashford", emergencyContactPhone: null })
        .where(eq(people.id, entry.person.id));
    }
    const nameOnly = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(nameOnly.actions.some((action) => action.id === `contact:${reef.id}`)).toBe(true);

    // A contact is only "on file" with a reachable number, so fill both.
    for (const entry of roster) {
      await db
        .update(people)
        .set({ emergencyContactName: "Kin Ashford", emergencyContactPhone: "+1 305 555 0175" })
        .where(eq(people.id, entry.person.id));
    }
    const cleared = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(cleared.actions.some((action) => action.id === `contact:${reef.id}`)).toBe(false);
  });

  it("never looks past its one-week horizon", async () => {
    const { db, shop } = await seededShopContext();

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const horizon = Date.now() + 7 * 24 * 60 * 60 * 1000;

    for (const action of work.actions) {
      expect(action.dueAt?.getTime() ?? 0).toBeLessThanOrEqual(horizon);
    }
  });

  it("points every action at a route inside this shop", async () => {
    const { db, shop } = await seededShopContext();

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(work.actions.length).toBeGreaterThan(0);
    for (const action of work.actions) {
      expect(action.href.startsWith(`/shop/${shop.slug}/`)).toBe(true);
      expect(action.actionLabel).toBeTruthy();
      expect(action.detail).toBeTruthy();
    }
  });
});

describe("role lens raw material", () => {
  it("marks the trips a captain crews and the sessions an instructor teaches", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const captain = staff.find((entry) => entry.roles.includes("captain"))?.person;
    const instructor = staff.find((entry) => entry.roles.includes("instructor"))?.person;
    if (!captain || !instructor) throw new Error("seed staff missing");

    const forCaptain = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      undefined,
      captain.id,
    );
    // The seed assigns the captain to every charter, so today's boat is theirs.
    for (const departure of forCaptain.departures.filter((d) => !d.courseTitle)) {
      expect(forCaptain.crewedTripIds).toContain(departure.tripId);
    }
    expect(forCaptain.crewedSessions).toHaveLength(0); // captain teaches nothing

    const forInstructor = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      undefined,
      instructor.id,
    );
    expect(forInstructor.crewedSessions.length).toBeGreaterThan(0);
    for (const session of forInstructor.crewedSessions) {
      expect(session.courseTitle).toBeTruthy();
      expect(session.ready + session.blocked).toBeLessThanOrEqual(session.booked);
    }

    const anonymous = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(anonymous.crewedTripIds).toHaveLength(0);
    expect(anonymous.crewedSessions).toHaveLength(0);
  });
});
