import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBookingParty } from "@/db/bookings";
import { getRecapPageData, type RecapPageData } from "@/db/recap";
import { bookings } from "@/db/schema";
import { createTrip, upcomingTripsWithCounts } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { buildAfterStateProps } from "./after-state";

const ctx = fileScopedShopContext();

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const actions = {
  submitReview: async () => {},
  uploadPhoto: async () => {},
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
    });
    const text = serialized(props);
    expect(text).not.toContain(data.personId);
    expect(text).not.toContain(bookingId);
    expect(props.trip).not.toHaveProperty("id");
    expect(props.trip).not.toHaveProperty("courseId");
    expect(props.trip).not.toHaveProperty("lensId");
    expect(props).not.toHaveProperty("personId");
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

    const ready = await buildAfterStateProps({ ...base, mintHandoff: true });
    expect(ready.heldNext?.title).toBe(ahead.title);
    expect(ready.nextDive).toBeNull();

    const recap = await buildAfterStateProps({ ...base, mintHandoff: false });
    expect(recap.heldNext ?? null).toBeNull();
    expect(serialized(recap)).not.toContain(ahead.title);
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
    });
    expect(props.params).toEqual(params);
    expect(props.ownReview).toBeNull();
    expect(props.ownPulse).toBeNull();
  });
});
