import { describe, expect, it } from "vitest";
import { createBookingParty } from "@/db/bookings";
import { getRecapPageData, type RecapPageData } from "@/db/recap";
import { upcomingTripsWithCounts } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
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
