import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBookingParty } from "@/db/bookings";
import {
  bookings,
  computerDives,
  computerImportBatches,
  divePackages,
  diveSites,
  people,
  shops,
  tripSightings,
} from "@/db/schema";
import { createTrip } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { diverTranslator } from "@/i18n/messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { getRecapPageData, type RecapPageData } from "./recap/store";
import { buildAfterStateProps, recapBuddyLinkUrl } from "./recap-after-state";

const ctx = fileScopedShopContext();

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const actions = {
  submitReview: async () => {},
  uploadPhoto: async () => {},
  unsharePhoto: async () => {},
  startTip: async () => {},
  submitPulse: async () => {},
};

async function recapData(): Promise<{ data: RecapPageData; bookingId: string }> {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Ava After",
      email: "ava.after@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  const data = await getRecapPageData(ctx.db, bookingId);
  if (!data) throw new Error("recap not open");
  return { data, bookingId };
}

/** Every string a client component receives, the bound actions aside. */
function serialized(props: Awaited<ReturnType<typeof buildAfterStateProps>>): string {
  const { t: _t, actions: _actions, ...rest } = props;
  return JSON.stringify(rest);
}

describe("buildAfterStateProps", () => {
  it("keeps two same-day departures' personal recordings date-level, timed and free of private import fields", async () => {
    const { data, bookingId } = await recapData();
    const day = calendarDateInTimezone(data.trip.startsAt, data.shop.timezone);
    const second = await createTrip(ctx.db, {
      shopId: data.shop.id,
      title: "Another departure that day",
      startsAt: new Date(data.trip.startsAt.getTime() + 60 * 60 * 1000),
      endsAt: new Date(data.trip.startsAt.getTime() + 2 * 60 * 60 * 1000),
      capacity: 6,
      plannedDives: 1,
    });
    if (!second) throw new Error("second departure missing");
    expect(calendarDateInTimezone(second.startsAt, data.shop.timezone)).toBe(day);
    const [seat] = await ctx.db
      .insert(bookings)
      .values({
        shopId: data.shop.id,
        tripId: second.id,
        personId: data.personId,
        bookedAs: "diver",
      })
      .returning();
    const otherData = await getRecapPageData(ctx.db, seat.id);
    if (!otherData) throw new Error("second recap missing");
    const [batch] = await ctx.db
      .insert(computerImportBatches)
      .values({
        shopId: data.shop.id,
        personId: data.personId,
        requestKey: randomUUID(),
        selectionHash: "private-import-selection",
        importedCount: 2,
        skippedCount: 0,
      })
      .returning();
    for (const time of ["08:00:00", "16:00:00"]) {
      await ctx.db.insert(computerDives).values({
        shopId: data.shop.id,
        personId: data.personId,
        batchId: batch.id,
        fingerprint: randomUUID(),
        annotation: "private annotation",
        record: {
          localStart: `${day}T${time}`,
          startInstant: null,
          offsetMinutes: null,
          device: "Own computer",
          durationSeconds: 1800,
          maxDepthMeters: 12,
          sourceId: "private-source-id",
          gases: [{ private: "not for recap" }],
        },
      });
    }
    const build = (recap: RecapPageData, id: string) =>
      buildAfterStateProps({
        db: ctx.db,
        data: recap,
        bookingId: id,
        locale: "en-US",
        t: diverTranslator("en-US"),
        params: {},
        actions,
        mintHandoff: false,
        delivered: false,
      });
    const morning = await build(data, bookingId);
    const afternoon = await build(otherData, seat.id);
    expect(morning.computerDives).toHaveLength(2);
    expect(afternoon.computerDives).toEqual(morning.computerDives);
    expect(morning.computerDives.map((dive) => dive.recordedAt)).toEqual([
      expect.stringMatching(/8:00.*time zone unknown/),
      expect.stringMatching(/4:00.*time zone unknown/),
    ]);
    const text = serialized(morning);
    for (const secret of [
      batch.id,
      data.personId,
      "private annotation",
      "private-source-id",
      "not for recap",
    ])
      expect(text).not.toContain(secret);
    expect(morning.sheet).not.toHaveProperty("computerDives");
    expect(JSON.stringify(morning.postcard)).not.toContain("Own computer");
    // A valid date-only import can have no depth, duration or samples. Preserve
    // the dated personal record without inventing any of those missing facts.
    await ctx.db
      .update(computerDives)
      .set({
        record: {
          localDate: day,
          localStart: null,
          startInstant: null,
          device: null,
          maxDepthMeters: null,
          durationSeconds: null,
        },
      })
      .where(eq(computerDives.batchId, batch.id));
    const dateOnly = await build(data, bookingId);
    expect(dateOnly.computerDives).toHaveLength(2);
    expect(
      dateOnly.computerDives.every((dive) =>
        dive.recordedAt.includes("time and time zone unknown"),
      ),
    ).toBe(true);
  });

  it("never carries the person, the trip, the course or the lens id onto the bearer-token page", async () => {
    const { data, bookingId } = await recapData();
    const props = await buildAfterStateProps({
      db: ctx.db,
      data,
      bookingId,
      locale: "en-US",
      t: diverTranslator("en-US"),
      params: {},
      actions,
      mintHandoff: false,
      delivered: false,
    });
    const text = serialized(props);
    expect(text).not.toContain(data.personId);
    expect(text).not.toContain(bookingId);
    expect(props.trip).not.toHaveProperty("id");
    expect(props.trip).not.toHaveProperty("courseId");
    expect(props.trip).not.toHaveProperty("lensId");
    expect(props).not.toHaveProperty("personId");
  });

  it("ties the logbook sheet to the booking and the read, and signs for no one the shop never saw", async () => {
    const { data, bookingId } = await recapData();
    const props = await buildAfterStateProps({
      db: ctx.db,
      data,
      bookingId,
      locale: "en-US",
      t: diverTranslator("en-US"),
      params: {},
      actions,
      mintHandoff: false,
      delivered: false,
    });
    expect(props.sheet.reference).toBe(bookingId.replace(/-/g, "").slice(0, 8).toUpperCase());
    expect(props.sheet.asOf).toMatch(/\d/);
    // Booked, no roll call, no sighting at the desk: nothing says they came.
    expect(props.sheet.signable).toBe(false);
  });

  it("offers the share-with-the-boat tick from any readiness link, never the forwardable recap (issue 4059)", async () => {
    const { data, bookingId } = await recapData();
    const build = (mintHandoff: boolean, delivered: boolean) =>
      buildAfterStateProps({
        db: ctx.db,
        data,
        bookingId,
        locale: "en-US",
        t: diverTranslator("en-US"),
        params: {},
        actions,
        mintHandoff,
        delivered,
      });
    expect((await build(true, true)).canShareWithBoat).toBe(true);
    expect((await build(true, false)).canShareWithBoat).toBe(true);
    expect((await build(false, false)).canShareWithBoat).toBe(false);
  });

  it("puts no URL, token, slug or id on the saved postcard", async () => {
    const { data, bookingId } = await recapData();
    const props = await buildAfterStateProps({
      db: ctx.db,
      data,
      bookingId,
      locale: "en-US",
      t: diverTranslator("en-US"),
      params: {},
      actions,
      mintHandoff: true,
      delivered: true,
    });
    const postcard = JSON.stringify(props.postcard);
    expect(postcard).not.toMatch(/https?:|\/s\/|\/ready\/|\/recap\//);
    expect(postcard).not.toContain(ctx.shop.slug);
    expect(postcard).not.toMatch(UUID);
    expect(props.postcard.privateLine).toBeNull();
    expect(props.postcard.facts[0]).toEqual({ label: expect.any(String), value: "Ava After" });
  });

  it("stamps the level a certifying session issued on the saved postcard", async () => {
    // Fourth review, item 55: the peak of a course, on the image the diver keeps.
    const { data, bookingId } = await recapData();
    const certified = {
      ...data,
      course: {
        title: "Open Water Diver",
        nextStep: null,
        certification: { level: "open_water" as const, issuedAt: data.trip.startsAt },
      },
    };
    const build = (recap: typeof data) =>
      buildAfterStateProps({
        db: ctx.db,
        data: recap,
        bookingId,
        locale: "en-US",
        t: diverTranslator("en-US"),
        params: {},
        actions,
        mintHandoff: false,
        delivered: false,
      });
    expect((await build(certified)).postcard.facts[1]).toEqual({
      label: "Certified",
      value: "Open Water",
    });
    expect((await build(data)).postcard.facts.map((fact) => fact.label)).not.toContain("Certified");
  });

  it("never mints a handoff from the recap link, whatever the board offers", async () => {
    const { data, bookingId } = await recapData();
    const props = await buildAfterStateProps({
      db: ctx.db,
      data,
      bookingId,
      locale: "en-US",
      t: diverTranslator("en-US"),
      params: {},
      actions,
      mintHandoff: false,
      delivered: false,
    });
    expect(props.nextDiveHref).toBeNull();
    expect(serialized(props)).not.toMatch(/[?&#]handoff=|\/h\//);
  });

  /**
   * **Never a seat they already hold** (fifth-loop ideas, item 37). The seat is
   * said on `/ready`, which only its holder opens; the forwardable recap link
   * says nothing about the diver's other bookings.
   */
  it("says the diver's next held seat on /ready and never on the recap link", async () => {
    const { data, bookingId } = await recapData();
    const [own] = await ctx.db
      .select({ personId: bookings.personId, tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    const startsAt = new Date(nowDate().getTime() + 7 * 24 * 60 * 60 * 1000);
    const ahead = await createTrip(ctx.db, {
      shopId: ctx.shop.id,
      title: "Held Saturday reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 6,
      plannedDives: 2,
    });
    if (!own || !ahead) throw new Error("held departure not created");
    await ctx.db.insert(bookings).values({
      shopId: ctx.shop.id,
      tripId: ahead.id,
      personId: own.personId,
      bookedAs: "diver",
    });
    const base = {
      db: ctx.db,
      data,
      bookingId,
      locale: "en-US" as const,
      t: diverTranslator("en-US"),
      params: {},
      actions,
    };

    const ready = await buildAfterStateProps({ ...base, mintHandoff: true, delivered: true });
    expect(ready.bookedNext?.title).toBe(ahead.title);
    expect(ready.nextDive).toBeNull();

    const recap = await buildAfterStateProps({ ...base, mintHandoff: false, delivered: false });
    expect(recap.bookedNext ?? null).toBeNull();
  });

  /**
   * **A booking-redirect link says nothing of the person's other seats**
   * (security review r5-4, second pass, FIX 1). Whoever booked as Ana holds
   * that link until a month after the day; once the day is over, it must not
   * tell them Ana's next booked departure, mint a handoff carrying her gear, or
   * hide the next-dive card because she holds one.
   */
  it("shows no booked seat and mints no handoff on an undelivered /ready link", async () => {
    const { data, bookingId } = await recapData();
    const [own] = await ctx.db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    const startsAt = new Date(nowDate().getTime() + 7 * 24 * 60 * 60 * 1000);
    const ahead = await createTrip(ctx.db, {
      shopId: ctx.shop.id,
      title: "Ana's private Saturday",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 6,
      plannedDives: 2,
      isPrivate: true,
    });
    if (!own || !ahead) throw new Error("later departure not created");
    await ctx.db.insert(bookings).values({
      shopId: ctx.shop.id,
      tripId: ahead.id,
      personId: own.personId,
      bookedAs: "diver",
    });
    const base = {
      db: ctx.db,
      data,
      bookingId,
      locale: "en-US" as const,
      t: diverTranslator("en-US"),
      params: {},
      actions,
      mintHandoff: true,
    };

    const redirect = await buildAfterStateProps({ ...base, delivered: false });
    expect(redirect.bookedNext ?? null).toBeNull();
    expect(redirect.nextDiveHref).toBeNull();
    expect(serialized(redirect)).not.toContain(ahead.title);
    // The card is what it would be with no later seat at all.
    await ctx.db.delete(bookings).where(eq(bookings.tripId, ahead.id));
    const withoutTheSeat = await buildAfterStateProps({ ...base, delivered: false });
    expect(redirect.nextDive?.tripId ?? null).toBe(withoutTheSeat.nextDive?.tripId ?? null);
  });

  it("passes the URL's notice params through untouched, for the component to read through noticeFromParam", async () => {
    const { data, bookingId } = await recapData();
    const params = { review: "__proto__", photo: "constructor", tip: "<script>", pulse: "saved" };
    const props = await buildAfterStateProps({
      db: ctx.db,
      data,
      bookingId,
      locale: "en-US",
      t: diverTranslator("en-US"),
      params,
      actions,
      mintHandoff: false,
      delivered: false,
    });
    expect(props.params).toEqual(params);
    expect(props.ownReview).toBeNull();
    expect(props.ownPulse).toBeNull();
  });
});

describe("recapBuddyLinkUrl", () => {
  const shop = { slug: "blue-mantis", buddyLinksEnabled: true };

  it("links to the shop's schedule with this booking's referral id", () => {
    expect(
      recapBuddyLinkUrl(shop, "6f1c7b8e-2a43-4c4e-9a7d-0c7d1d9e4b21", "https://diveday.test"),
    ).toMatch(/^https:\/\/diveday\.test\/s\/blue-mantis\?via=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("is null when the shop switched Bring a buddy off, or has no origin", () => {
    const id = "6f1c7b8e-2a43-4c4e-9a7d-0c7d1d9e4b21";
    expect(
      recapBuddyLinkUrl({ ...shop, buddyLinksEnabled: false }, id, "https://diveday.test"),
    ).toBeNull();
    expect(recapBuddyLinkUrl(shop, id, null)).toBeNull();
  });
});

/**
 * Sightings switched off on Features: the recap names no species the crew
 * logged, and the sighting itself stays.
 */
describe("the recap with sightings switched off", () => {
  it("names nothing the crew logged, and names it again once back on", async () => {
    const { bookingId } = await recapData();
    const { db, shop } = ctx;
    const [booking] = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    const [site] = await db
      .select({ id: diveSites.id, name: diveSites.name })
      .from(diveSites)
      .where(eq(diveSites.shopId, shop.id))
      .limit(1);
    const [crew] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    if (!booking || !site || !crew) throw new Error("seed is missing a trip, a site or a person");
    await db.insert(tripSightings).values({
      shopId: shop.id,
      tripId: booking.tripId,
      diveSiteId: site.id,
      diveSiteName: site.name,
      speciesSlug: "green-sea-turtle",
      count: 1,
      recordedByPersonId: crew.id,
    });
    expect((await getRecapPageData(db, bookingId))?.observedSpecies).toContain("green-sea-turtle");

    await db.update(shops).set({ sightingsEnabled: false }).where(eq(shops.id, shop.id));
    const off = await getRecapPageData(db, bookingId);
    expect(off?.observedSpecies).toEqual([]);
    await db.update(shops).set({ sightingsEnabled: true }).where(eq(shops.id, shop.id));
  });
});

// Issue #4328: one quiet row, a course before a package, nothing when neither.
describe("the what's-next row", () => {
  async function whatsNext(data: RecapPageData, bookingId: string) {
    const props = await buildAfterStateProps({
      db: ctx.db,
      data,
      bookingId,
      locale: "en-US",
      t: diverTranslator("en-US"),
      params: {},
      actions,
      mintHandoff: false,
      delivered: false,
    });
    return props.whatsNext;
  }

  async function setShop(values: { coursesEnabled?: boolean; divePackagesEnabled?: boolean }) {
    await ctx.db.update(shops).set(values).where(eq(shops.id, ctx.shop.id));
  }

  it("names the next course on the shop's ladder for a diver with no card", async () => {
    const { data, bookingId } = await recapData();
    const row = await whatsNext(data, bookingId);
    expect(row?.href).toMatch(new RegExp(`^/s/${ctx.shop.slug}/courses/`));
    expect(row?.detail).toMatch(/^Your next course/);
  });

  it("offers a package to a repeat diver once no course is left, and nothing to a first-timer", async () => {
    await setShop({ coursesEnabled: false, divePackagesEnabled: true });
    try {
      const { data, bookingId } = await recapData();
      expect(await whatsNext({ ...data, visitCount: 1 }, bookingId)).toBeNull();
      await ctx.db.insert(divePackages).values({
        shopId: ctx.shop.id,
        name: "Five-dive card",
        diveCount: 5,
        priceCents: 30_000,
        scope: "all",
      });
      const row = await whatsNext({ ...data, visitCount: 2 }, bookingId);
      expect(row?.href).toBe(`/s/${ctx.shop.slug}/packages`);
      expect(row?.detail).toMatch(/prepaid dives$/);
    } finally {
      await setShop({ coursesEnabled: true });
    }
  });

  it("says nothing when the shop sells neither", async () => {
    await setShop({ coursesEnabled: false, divePackagesEnabled: false });
    try {
      const { data, bookingId } = await recapData();
      expect(await whatsNext({ ...data, visitCount: 5 }, bookingId)).toBeNull();
    } finally {
      await setShop({ coursesEnabled: true, divePackagesEnabled: true });
    }
  });
});
