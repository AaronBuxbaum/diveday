import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { boatWorkItems } from "@/lib/boat-work";
import { nowDate, nowMs } from "@/lib/clock";
import type { TodayAction } from "@/lib/today";
import { fileScopedShopContext } from "@/test/db";
import { fakePromotions } from "@/test/fakes";
import { cancelBooking } from "./bookings";
import { joinLastMinuteList } from "./last-minute-list";
import { setBookingNitrox } from "./nitrox";
import { boats, nitroxCertifications, orders, people, tripWaitlistEntries } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getTodayWork } from "./today";
import { pushDepartureRows } from "./today-departure-rows";
import { rowsContext } from "./today-rows-test-fixtures";
import { sendLastMinuteDealBlast } from "./trip-promos";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { listStaff } from "./trips-crew";
import { getTripOverview } from "./trips-overview";

const emptyWave = {
  boatWork: new Map(),
  waitlisted: new Map(),
  courseCrewCounts: new Map(),
  deliveryIssues: [],
  neverSentLastMinuteDeal: new Set(),
  lastMinuteWindows: [],
  boardedAnywhere: new Map(),
  sharedWelcomeSeats: new Map(),
};

describe("pushDepartureRows", () => {
  it("adds nothing for an empty window with no bounced email", () => {
    const actions: TodayAction[] = [];
    pushDepartureRows(actions, rowsContext(emptyWave));
    expect(actions).toEqual([]);
  });
});

/** One database for the file, one transaction per test (`fileScopedShopContext`, src/test/db.ts). */
const ctx = fileScopedShopContext();

describe("departure rows on the queue, read through getTodayWork", () => {
  it("makes a freed seat one-tap invitable, targeting the front of the wait list", async () => {
    const { db, shop } = ctx;
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
    expect(row?.detail).toContain("2 on the wait list");
    expect(row?.invite).toBeDefined();
    expect(row?.invite?.entryId).toBe(frontEntry.id);
    expect(row?.invite?.personName).toBe("Marina Reyes");
    expect(row?.invite?.personEmail).toBe("marina@example.com");
    expect(row?.invite?.tripId).toBe(reef.id);
    expect(row?.invite?.bookingPath).toBe(`/s/${shop.slug}/trips/${reef.id}`);
  });

  it("nudges an under-capacity trip departing soon that has never had a last-minute deal sent", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");

    // Somebody to send the deal to. A diver who states no dates is around for
    // every departure — without one on the list the row is correctly absent
    // (the test below), so this is the row's premise, not scenery.
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `last-minute-fill:${reef.id}`);
    expect(row?.kind).toBe("last_minute_fill");
    expect(row?.detail).toContain(`${reef.capacity - reef.booked} seats open`);
  });

  /** The seats to fill are the seats on sale (H-107, #2388), not the stated number. */
  it("counts the seats to fill against the boat's certificate", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef?.boatId) throw new Error("demo reef trip missing its boat");
    await db
      .update(boats)
      .set({ certifiedPassengers: reef.booked + 1 })
      .where(eq(boats.id, reef.boatId));
    expect(reef.capacity - reef.booked).toBeGreaterThan(1);
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `last-minute-fill:${reef.id}`);
    expect(row?.detail).toMatch(/^1 seat open/);
  });

  it("does not nudge to fill seats when nobody on the last-minute list is around for that date", async () => {
    // The row's whole job is "send a deal to the people waiting for one." With
    // nobody reachable there is nothing to send, the trip's Guests tab hides
    // the panel outright, and the row's own `#last-minute-deal` anchor would
    // land on nothing.
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");

    // On the list, but stating a window months after this departure — the
    // sharper case than an empty list, because the entry exists and still must
    // not count.
    const nextYear = new Date(nowMs() + 300 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      availableFrom: nextYear,
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(
      work.actions.find((action) => action.id === `last-minute-fill:${reef.id}`),
    ).toBeUndefined();
  });

  it("stops nudging once a last-minute deal has actually been sent for that trip", async () => {
    const { db, shop } = ctx;
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
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
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
    const { db, shop } = ctx;
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
      .set({ deletedAt: nowDate() })
      .where(
        and(
          eq(nitroxCertifications.shopId, shop.id),
          eq(nitroxCertifications.personId, certified.person.id),
        ),
      );

    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const nitroxAction = after.actions.find((action) => action.id === `nitrox:${reef.id}`);
    // One diver is a row about that person, by name, never "1 diver wants…".
    expect(nitroxAction?.subject).toBe("Priya Sharma");
    expect(nitroxAction?.detail).toBe("Wants nitrox, no verified card.");
  });

  it("nudges staff about missing emergency contacts on a near boat, and clears once filled", async () => {
    const { db, shop } = ctx;
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
    expect(contactAction?.href).toBe(`/shop/${shop.slug}/trips/${reef.id}`);

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

  // Third review, item 4: Today said four jobs for a boat whose own band said
  // two. Both now read one reader, so the boat's work on Today is exactly the
  // band's, row for row, in the same words.
  it("lists a boat's work on Today exactly as the boat's own band does", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    for (const entry of roster) {
      await db
        .update(people)
        .set({ emergencyContactName: null, emergencyContactPhone: null })
        .where(eq(people.id, entry.person.id));
    }
    const owner = (await listStaff(db, shop.id)).find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("seeded shop has no owner");

    const [today, overview] = await Promise.all([
      getTodayWork(db, shop.id, shop.slug, shop.timezone),
      getTripOverview(db, shop, reef.id, owner.person.id),
    ]);
    if (!overview) throw new Error("overview missing");
    const band = boatWorkItems(overview.pulse.work, { startsAt: reef.startsAt, now: nowDate() });
    expect(band.map((item) => item.code)).toContain("missing_contact");

    const prefix = {
      missing_sizes: "prep",
      ungated_nitrox: "nitrox",
      missing_contact: "contact",
      open_orders: "orders",
    } as const;
    const onToday = today.actions
      .filter((action) => action.departure?.tripId === reef.id)
      .map((action) => action.id.split(":")[0]);
    for (const item of band) expect(onToday).toContain(prefix[item.code]);
    const workPrefixes = new Set<string>(Object.values(prefix));
    expect(onToday.filter((id) => id && workPrefixes.has(id))).toHaveLength(band.length);
  });

  // Layer 1 review, finding 3: the orders count read every booking on the
  // departure, so an unpaid invoice on a seat the diver gave up still said
  // "1 order awaiting payment" while sizes, nitrox and contacts read only the
  // seats still on the boat. All four now count the same seats.
  it("does not count an open order on a cancelled seat as the boat's work", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [seat] = await getTripRoster(db, shop.id, reef.id);
    if (!seat) throw new Error("demo bookings missing");
    const owner = (await listStaff(db, shop.id)).find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("seeded shop has no owner");
    await db.insert(orders).values({
      shopId: shop.id,
      bookingId: seat.booking.id,
      personId: seat.person.id,
      createdByPersonId: owner.person.id,
      status: "open",
      currency: "usd",
      totalCents: 17_500,
      amountPaidCents: 0,
      description: "Two-tank charter balance",
      stripeAccountId: "acct_demo",
      stripeCustomerId: "cus_test_cancelled_seat",
      stripeInvoiceId: "in_test_cancelled_seat",
      finalizedAt: nowDate(),
    });
    const ordersRow = `orders:${reef.id}`;

    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(before.actions.some((action) => action.id === ordersRow)).toBe(true);

    await cancelBooking(db, shop.id, seat.booking.id);

    const [today, overview] = await Promise.all([
      getTodayWork(db, shop.id, shop.slug, shop.timezone),
      getTripOverview(db, shop, reef.id, owner.person.id),
    ]);
    expect(today.actions.some((action) => action.id === ordersRow)).toBe(false);
    expect(overview?.pulse.work.openOrders).toBe(0);
  });
});
