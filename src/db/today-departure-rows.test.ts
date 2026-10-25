import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate, nowMs } from "@/lib/clock";
import { oneRowPerDiver, type TodayAction } from "@/lib/today";
import { fileScopedShopContext } from "@/test/db";
import { sendDeal } from "@/test/deal";
import { fakePromotions } from "@/test/fakes";
import { cancelBooking } from "./bookings";
import { askAnytime } from "./interests";
import { setBookingNitrox } from "./nitrox";
import { boats, bookings, interests, nitroxCertifications, orders, people, shops } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getTodayWork } from "./today";
import { getDepartureNeeds } from "./today-departure-needs";
import { pushDepartureRows } from "./today-departure-rows";
import { NOW, rowsContext, rowsNaming } from "./today-rows-test-fixtures";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { listStaff } from "./trips-crew";
import { getTripOverview } from "./trips-overview";
import { setWelcomeConsent } from "./welcome-cues";

const emptyWave = {
  boatWork: new Map(),
  seatWanted: new Map(),
  courseCrewCounts: new Map(),
  deliveryIssues: [],
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

  // UX delight sheet 2026-10-22, item 4: "3 people have no emergency contact"
  // sent the desk to the roster to find out who.
  const trip = {
    id: "t1",
    title: "Reef Drift",
    startsAt: new Date(NOW.getTime() + 2 * 3_600_000),
    sellableCapacity: 12,
    booked: 6,
  };
  const ana = { personId: "p-ana", fullName: "Ana Ruiz" };
  const ben = { personId: "p-ben", fullName: "Ben Cole" };
  const cara = { personId: "p-cara", fullName: "Cara Diaz" };
  const pushed = (wave: Record<string, unknown>, overrides = {}) => {
    const actions: TodayAction[] = [];
    pushDepartureRows(
      actions,
      rowsContext({ ...emptyWave, ...wave }, { inWindow: [trip] as never, ...overrides }),
    );
    // The boat's crew gap is another builder's row; these tests read the rows about people and orders.
    return actions.filter((action) => action.kind !== "uncrewed_departure");
  };

  it("names each diver a boat's work counts, one row per gap, and keeps orders a count", () => {
    const actions = pushed({
      boatWork: new Map([
        [
          "t1",
          {
            missingSize: [ana],
            kitUnasked: [ben],
            ungatedNitrox: [ana],
            missingContact: [ana, cara],
            openOrders: 2,
          },
        ],
      ]),
    });
    expect(
      actions.map((action) => [action.kind, action.subject, action.diver?.items ?? null]),
    ).toEqual([
      ["dive_prep", "Ana Ruiz", ["rental size"]],
      ["dive_prep", "Ben Cole", ["kit"]],
      ["nitrox_gate", "Ana Ruiz", ["nitrox certification"]],
      ["emergency_contact", "Ana Ruiz", ["emergency contact"]],
      ["emergency_contact", "Cara Diaz", ["emergency contact"]],
      ["payment", "Reef Drift", null],
    ]);
    const prep = actions[0];
    expect(prep?.detail).toBe("Missing a rental size.");
    expect(prep?.actionLabel).toBe("Open prep list");
    // The packing list reads on the departure (ADR 20260919-one-idea, slice 23c).
    expect(prep?.href).toBe("/shop/blue-mantis/trips/t1/prep#packing-list");
    expect(actions[1]?.detail).toBe("Not asked about kit.");
    expect(actions[3]?.href).toBe("/shop/blue-mantis/trips/t1");
    // Orders cannot name a person: one row about the boat.
    expect(actions[5]?.aboutDeparture).toBe(true);
    expect(actions[5]?.detail).toBe("2 orders awaiting payment");

    // Then Ana is one row with everything open for her, the warning first,
    // then her contact gap above her size (the rank, visual review A43).
    const folded = oneRowPerDiver(actions);
    expect(folded.filter((action) => action.subject === "Ana Ruiz")).toHaveLength(1);
    expect(folded.find((action) => action.subject === "Ana Ruiz")?.detail).toBe(
      "nitrox certification, emergency contact, rental size",
    );
    expect(folded).toHaveLength(4);
  });

  // Aaron 2026-10-23: three divers nobody asked about kit read as three rows
  // saying the same thing. Two or more share one line for the boat.
  it("folds a boat's divers nobody asked about kit into one line naming every one", () => {
    const dev = { personId: "p-dev", fullName: "Dev Shah" };
    const eli = { personId: "p-eli", fullName: "Eli Park" };
    const fay = { personId: "p-fay", fullName: "Fay Lund" };
    const actions = pushed({
      boatWork: new Map([
        [
          "t1",
          {
            missingSize: [ana],
            kitUnasked: [ben, cara, dev, eli, fay],
            ungatedNitrox: [],
            missingContact: [],
            openOrders: 0,
          },
        ],
      ]),
    });
    expect(actions.map((action) => [action.id, action.subject])).toEqual([
      ["kit-unasked:t1", "Reef Drift"],
      ["prep:t1:p-ana", "Ana Ruiz"],
    ]);
    const kit = actions[0];
    expect(kit?.aboutDeparture).toBe(true);
    expect(kit?.diver).toBeUndefined();
    // No "and 3 more": the row has nothing to open, so nobody is left unnamed.
    expect(kit?.detail).toBe(
      "Not asked about kit: Ben Cole, Cara Diaz, Dev Shah, Eli Park and Fay Lund.",
    );
    expect(kit?.href).toBe("/shop/blue-mantis/trips/t1/prep#packing-list");
    expect(kit?.departure?.tripId).toBe("t1");
  });

  it("names every blocked diver and nobody who is ready, in their own row", () => {
    const seat = (id: string, fullName: string, blockers: readonly { code: string }[]) => ({
      booking: { id: `b-${id}` },
      person: { id: `p-${id}`, fullName },
      readiness: { status: blockers.length > 0 ? "blocked" : "ready", blockers },
    });
    const actions = pushed(
      {},
      {
        readinessByTrip: new Map([
          [
            "t1",
            [
              seat("ana", "Ana Ruiz", [{ code: "waiver_not_sent" }]),
              seat("ben", "Ben Cole", [{ code: "waiver_not_sent" }]),
              seat("dev", "Dev Shah", []),
              seat("cara", "Cara Diaz", [
                { code: "waiver_pending" },
                { code: "certification_missing" },
                { code: "medical_review" },
                { code: "payment_due" },
                { code: "identity_unconfirmed" },
              ]),
            ],
          ],
        ]) as never,
      },
    );
    expect(actions.filter((action) => action.diver).map((action) => action.subject)).toEqual([
      "Ana Ruiz",
      "Ben Cole",
      "Cara Diaz",
    ]);
    // Ana and Ben share an unsent waiver: one tap above them sends both.
    const batch = actions.find((action) => !action.diver);
    expect(batch?.detail).toBe("2 waivers not signed, not sent yet");
    expect(batch?.waiver).toEqual({ bookingIds: ["b-ana", "b-ben"] });
    expect(actions.find((action) => action.subject === "Cara Diaz")?.diver?.items).toHaveLength(5);
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
    const asked = {
      shopId: shop.id,
      tripId: reef.id,
      scope: "departure",
      askedBy: "diver",
    } as const;
    await db.insert(interests).values([
      {
        ...asked,
        personId: front.id,
        partySize: 1,
        askedAt: new Date("2020-01-01T00:00:00.000Z"),
      },
      {
        ...asked,
        personId: later.id,
        partySize: 1,
        askedAt: new Date("2020-02-01T00:00:00.000Z"),
      },
    ]);
    const frontEntry = (
      await db
        .select()
        .from(interests)
        .where(and(eq(interests.tripId, reef.id), eq(interests.personId, front.id)))
    )[0];
    if (!frontEntry) throw new Error("front entry missing");

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `seat-wanted:${reef.id}`);
    expect(row?.kind).toBe("seat_wanted");
    // Depth is counted, but the offer targets the earliest joiner specifically.
    expect(row?.detail).toContain("2 want in");
    expect(row?.offer).toBeDefined();
    expect(row?.offer?.interestId).toBe(frontEntry.id);
    expect(row?.offer?.personName).toBe("Marina Reyes");
    expect(row?.offer?.personEmail).toBe("marina@example.com");
    expect(row?.offer?.tripId).toBe(reef.id);
    expect(row?.offer?.bookingPath).toBe(`/s/${shop.slug}/trips/${reef.id}`);
  });

  it("keeps a diver already waiting on Today after the wait list is switched off", async () => {
    // Review 2026-10-23, item 8: switched off, nobody new joins, but whoever
    // was already waiting stays in front of the desk until someone handles them.
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [waiter] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Ola Offswitch", email: "ola-off@example.com" })
      .returning();
    if (!waiter) throw new Error("could not seed a waiter");
    await db.insert(interests).values({
      shopId: shop.id,
      tripId: reef.id,
      scope: "departure",
      askedBy: "diver",
      personId: waiter.id,
      partySize: 1,
    });
    await db.update(shops).set({ waitlistEnabled: false }).where(eq(shops.id, shop.id));

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `seat-wanted:${reef.id}`);
    expect(row?.offer?.personName).toBe("Ola Offswitch");
    expect(await db.select().from(interests).where(eq(interests.personId, waiter.id))).toHaveLength(
      1,
    );
  });

  // Dive-domain review of #2656, m2: one tap must not email "a seat opened" to
  // a party the open seats cannot hold whole; the roll already skips them.
  it("offers the one tap to the first party that fits whole, and to nobody when none does", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const open = reef.capacity - reef.booked;
    expect(open).toBeGreaterThan(0);
    const [big, small] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Big Party", email: "big-party@example.com" },
        { shopId: shop.id, fullName: "Solo Diver", email: "solo@example.com" },
      ])
      .returning();
    if (!big || !small) throw new Error("could not seed waiters");
    const asked = {
      shopId: shop.id,
      tripId: reef.id,
      scope: "departure",
      askedBy: "diver",
    } as const;
    await db.insert(interests).values({
      ...asked,
      personId: big.id,
      partySize: open + 1,
      askedAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    const alone = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const tooBig = alone.actions.find((action) => action.id === `seat-wanted:${reef.id}`);
    expect(tooBig?.detail).toContain("1 want in");
    expect(tooBig?.offer).toBeUndefined();

    await db.insert(interests).values({
      ...asked,
      personId: small.id,
      partySize: 1,
      askedAt: new Date("2020-02-01T00:00:00.000Z"),
    });
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `seat-wanted:${reef.id}`);
    expect(row?.detail).toContain("2 want in");
    expect(row?.offer?.personName).toBe("Solo Diver");
  });

  it("does not count a diver who already holds a seat (seated means hidden)", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [seated, waiting] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Ines Seated", email: "ines@example.com" },
        { shopId: shop.id, fullName: "Omar Waiting", email: "omar@example.com" },
      ])
      .returning();
    if (!seated || !waiting) throw new Error("could not seed people");
    const asked = {
      shopId: shop.id,
      tripId: reef.id,
      scope: "departure",
      askedBy: "diver",
    } as const;
    await db.insert(interests).values([
      {
        ...asked,
        personId: seated.id,
        partySize: 1,
        askedAt: new Date("2020-01-01T00:00:00.000Z"),
      },
      {
        ...asked,
        personId: waiting.id,
        partySize: 1,
        askedAt: new Date("2020-02-01T00:00:00.000Z"),
      },
    ]);
    await db.insert(bookings).values({
      bookedAs: "diver",
      shopId: shop.id,
      tripId: reef.id,
      personId: seated.id,
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `seat-wanted:${reef.id}`);
    expect(row?.detail).toContain("1 want in");
    expect(row?.offer?.personName).toBe("Omar Waiting");
  });

  it("folds the last-minute list into the one seat_wanted row: N want in, with the panel as its door", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");

    // Somebody to send the deal to. A diver who states no dates is around for
    // every departure — without one on the list the row is correctly absent
    // (the test below), so this is the row's premise, not scenery.
    await askAnytime(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `seat-wanted:${reef.id}`);
    expect(row?.kind).toBe("seat_wanted");
    expect(row?.detail).toContain(`${reef.capacity - reef.booked} seats open`);
    expect(row?.detail).toMatch(/\d+ want in/);
    // Nobody waits for this boat itself, so there is no one to offer in place:
    // the tap opens the panel, where the list is offered a seat together.
    expect(row?.offer).toBeUndefined();
    expect(row?.href).toContain("#who-wants-in");
    expect(work.actions.some((action) => action.id.startsWith("last-minute-fill"))).toBe(false);
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
    await askAnytime(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `seat-wanted:${reef.id}`);
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
    await askAnytime(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      availableFrom: nextYear,
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(work.actions.find((action) => action.id === `seat-wanted:${reef.id}`)).toBeUndefined();
  });

  it("keeps the row after a deal went out: the list still wants in, and the panel says who was offered", async () => {
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
    await askAnytime(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
    });
    const sent = await sendDeal(
      db,
      { shopId: shop.id, shopSlug: shop.slug, tripId: reef.id, discountPercent: 25 },
      fakePromotions(),
    );
    expect(sent.ok).toBe(true);

    // One item for everyone who wants in, so a sent deal no longer retires it
    // (the one-shot "no deal sent yet" rule went with `last_minute_fill`).
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(work.actions.find((action) => action.id === `seat-wanted:${reef.id}`)).toBeDefined();
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

    const nitroxRows = (work: Awaited<ReturnType<typeof getTodayWork>>) =>
      rowsNaming(work.actions, reef.id, "nitrox certification");
    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(nitroxRows(before)).toEqual([]);

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
    // A row about that person, by name, never "1 diver wants…"; folded with
    // anything else open for her on this boat.
    expect(nitroxRows(after).map((action) => action.subject)).toEqual(["Priya Sharma"]);
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

    const contactRows = (work: Awaited<ReturnType<typeof getTodayWork>>) =>
      rowsNaming(work.actions, reef.id, "emergency contact");
    const flagged = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    // Every diver on the boat, by name and once each (UX delight sheet
    // 2026-10-22, item 4), never "3 people have no emergency contact".
    expect(
      contactRows(flagged)
        .map((action) => action.subject)
        .sort(),
    ).toEqual(roster.map((entry) => entry.person.fullName).sort());
    // Never a boarding blocker: a diver whose only gap it is gets the plain
    // contact row, pointed at the roster to settle at the counter. A diver
    // with a size open too is one row naming both, and since A43 their
    // contact gap leads it, so that row is a contact row as well: the
    // standalone nudge is the one naming nothing else.
    const contactOnly = contactRows(flagged).find(
      (action) => action.kind === "emergency_contact" && action.diver?.items.length === 1,
    );
    expect(contactOnly).toBeDefined();
    if (contactOnly) {
      expect(contactOnly.detail).toBe("No emergency contact.");
      expect(contactOnly.href).toBe(`/shop/${shop.slug}/trips/${reef.id}`);
    }

    // A name with no phone is unreachable in an incident — still flagged.
    for (const entry of roster) {
      await db
        .update(people)
        .set({ emergencyContactName: "Kin Ashford", emergencyContactPhone: null })
        .where(eq(people.id, entry.person.id));
    }
    const nameOnly = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(contactRows(nameOnly)).toHaveLength(roster.length);

    // A contact is only "on file" with a reachable number, so fill both.
    for (const entry of roster) {
      await db
        .update(people)
        .set({ emergencyContactName: "Kin Ashford", emergencyContactPhone: "+1 305 555 0175" })
        .where(eq(people.id, entry.person.id));
    }
    const cleared = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(contactRows(cleared)).toEqual([]);
  });

  // Third review, item 4, then fourth review, item 36: Today listed seven rows
  // for the 1:30 PM boat while its own band said "3 things to sort", because
  // the band counted only the boat's work and this test only compared that
  // subset. The band now reads Today's rows for the departure themselves, so
  // what is pinned here is the whole list a person sees on each screen.
  it("gives the boat's band exactly the rows Today lists for that boat", async () => {
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
    const now = nowDate();
    const t = staffTranslator("en-US");
    const [today, needs] = await Promise.all([
      getTodayWork(db, shop.id, shop.slug, shop.timezone, now),
      getDepartureNeeds(db, shop, reef.id, {
        now,
        t,
        locale: "en-US",
        session: { user: { roles: ["owner"] } },
      }),
    ]);
    const onToday = today.actions.filter((action) => action.departure?.tripId === reef.id);
    expect(needs?.map((action) => action.id)).toEqual(onToday.map((action) => action.id));
    expect(needs?.map((action) => action.detail)).toEqual(onToday.map((action) => action.detail));
    // More than the boat's work: the contacts row is there, and so is every
    // row the boat's work never counted.
    expect(rowsNaming(needs ?? [], reef.id, "emergency contact").length).toBeGreaterThan(0);
    expect(needs?.some((action) => !/^(prep|nitrox|contact|orders):/.test(action.id))).toBe(true);
  });

  it("gives no list for a boat outside Today's window, which Today does not show", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const far = trips.find((trip) => trip.startsAt.getTime() - now.getTime() > 14 * 86_400_000);
    if (!far) throw new Error("demo has no departure two weeks out");
    const t = staffTranslator("en-US");
    expect(
      await getDepartureNeeds(db, shop, far.id, {
        now,
        t,
        locale: "en-US",
        session: { user: { roles: ["owner"] } },
      }),
    ).toBeNull();
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

/**
 * **Saying hello is a line on the card, not a job** (fifth loop, item 10). A
 * diver who shared that this is their first trip is named on today's
 * departure, and nothing in the queue (or its count) asks anyone to greet them.
 */
describe("the welcome cue on Today", () => {
  it("rides on the departure and never becomes a Needs you row", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    const departure = before.departures.find((row) => row.booked > 0);
    if (!departure) throw new Error("demo needs a booked departure today");
    const roster = await getTripRoster(db, shop.id, departure.tripId);
    const seat = roster[0];
    if (!seat) throw new Error("departure has no roster");
    await setWelcomeConsent(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      shared: true,
      now,
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    const card = work.departures.find((row) => row.tripId === departure.tripId);
    expect(card?.welcome?.map((entry) => entry.name)).toContain(seat.person.fullName);
    expect(work.actions.map((action) => action.kind as string)).not.toContain("say_hello");
  });
});
