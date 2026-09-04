import { describe, expect, it, vi } from "vitest";

import { seededShopContext } from "@/test/db";

/**
 * **The diver's `.ics`, as a living anchor for the day** (issue #1165, D05).
 *
 * Two of the three assertions here are about the file being *right about where
 * and when*, which is the only thing a calendar entry is for. The third is the
 * restraint: this route is public and holds no booking, so the packing line
 * D05 also asks for cannot be composed here without inventing it.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

// `requestTranslator` reads the reader's own locale cookie, which needs a
// request scope Next only provides in a real render. The words are not what
// these cases are about — where and when are — so the shop's default locale
// stands in for the negotiation.
vi.mock("@/i18n/request", async () => {
  const { diverTranslator } = await import("@/i18n/messages");
  return {
    requestTranslator: async () => ({ t: diverTranslator("en-US"), locale: "en-US" }),
    requestLocale: async () => "en-US",
  };
});

const { getDb } = await import("@/db/client");
const { GET } = await import("./route");
const { upcomingTripsWithCounts } = await import("@/db/trips");
const { shops, trips } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

/** The seeded demo's next departure, with the fields this route reads set. */
async function aDeparture(meetingPoint: { label: string; address: string } | null) {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  await db.update(shops).set({ dockCallMinutes: 45 }).where(eq(shops.id, shop.id));
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("seed has no upcoming departure");
  await db
    .update(trips)
    .set({
      startsAt: new Date("2030-08-05T13:00:00Z"),
      endsAt: new Date("2030-08-05T17:30:00Z"),
      meetingPointLabel: meetingPoint?.label ?? null,
      meetingPointAddress: meetingPoint?.address ?? null,
    })
    .where(eq(trips.id, trip.id));
  return { db, shop, tripId: trip.id };
}

async function fetchIcs(shopSlug: string, tripId: string) {
  const response = await GET(
    new Request(`https://diveday.example/s/${shopSlug}/trips/${tripId}/calendar`) as never,
    { params: Promise.resolve({ shopSlug, id: tripId }) },
  );
  expect(response.status).toBe(200);
  return response.text();
}

describe("GET /s/[shopSlug]/trips/[id]/calendar", () => {
  it("starts the event at the dock call and says when the boat actually leaves", async () => {
    const { shop, tripId } = await aDeparture(null);
    const file = await fetchIcs(shop.slug, tripId);

    // 45 minutes before 13:00Z. An event beginning when the lines come off is
    // an event that makes a punctual diver late, and the trip page already
    // tells them to arrive for the dock call.
    expect(file).toContain("DTSTART:20300805T121500Z");
    expect(file).toContain("DTEND:20300805T173000Z");
    // Nothing is hidden by the shift: the departure is stated in the same
    // breath, so the calendar and the page cannot read as disagreeing.
    expect(file).toMatch(/DESCRIPTION:.*Dock call/);
    // DTSTAMP stays on the published departure — it is about the trip this
    // copy describes, not about when the diver has to be standing there.
    expect(file).toContain("DTSTAMP:20300805T130000Z");
  });

  it("points at the meeting point, never at a reef", async () => {
    // The bug: this used to hand the calendar the *dive site's* location name,
    // which for a boat dive is a place no navigation app can take anyone to —
    // and for a departure with its own meeting point, the wrong parking lot.
    const { shop, tripId } = await aDeparture({
      label: "Blue Mantis dock",
      address: "12 Ocean Dr, Key Largo",
    });
    const file = await fetchIcs(shop.slug, tripId);

    expect(file).toContain("LOCATION:Blue Mantis dock\\, 12 Ocean Dr\\, Key Largo");
    expect(file).toMatch(/DESCRIPTION:.*Meet at Blue Mantis dock/);
  });

  it("says nothing about packing, because it cannot know", async () => {
    // The restraint D05's boundary asks for. This route is public and holds no
    // booking, so what *this* diver rented, is bringing, or is provided is not
    // knowable here — and a generic line would be a fact about the day the
    // shop never stated.
    const { shop, tripId } = await aDeparture(null);
    const file = await fetchIcs(shop.slug, tripId);
    expect(file).not.toMatch(/Bring/i);
  });
});
