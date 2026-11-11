import { describe, expect, it, vi } from "vitest";

import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

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
const { courses, shops, trips, tripScheduleDays } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

/** The seeded demo's next departure, with the fields this route reads set. */
async function aDeparture(meetingPoint: { label: string; address: string } | null) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  await db.update(shops).set({ dockCallMinutes: 45 }).where(eq(shops.id, shop.id));
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => !row.courseId);
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
  it("exports the seeded introductory course at its advertised start with its actual plan", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (row) => row.title === "Discover Scuba — Pool & Reef",
    );
    if (!trip?.course) throw new Error("seed has no introductory session");
    const file = await fetchIcs(shop.slug, trip.id);
    const start = trip.startsAt.toISOString().replace(/[-:]/g, "").replace(".000Z", "Z");
    expect(file).toContain(`DTSTART:${start}`);
    expect(file).toContain("Briefing:");
    expect(file).toContain("Confined water:");
    expect(file).toContain("One shallow open-water dive");
    expect(file).not.toMatch(/Dock call|We leave|LOCATION:|\{depth/);
  });

  it("exports the three actual Open Water meetings, with classroom content and no reef location", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (row) => row.title === "Open Water Diver — three-day course",
    );
    if (!trip?.course) throw new Error("seed has no Open Water session");
    await db.update(shops).set({ dockCallMinutes: 30 }).where(eq(shops.id, shop.id));
    await db
      .update(trips)
      .set({
        startsAt: new Date("2026-11-20T13:00:00Z"),
        endsAt: new Date("2026-11-22T21:00:00Z"),
        meetingPointLabel: null,
        meetingPointAddress: null,
      })
      .where(eq(trips.id, trip.id));
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, trip.id));
    await db.insert(tripScheduleDays).values(
      [20, 21, 22].map((date, index) => ({
        tripId: trip.id,
        dayNumber: index + 1,
        startsAt: new Date(`2026-11-${date}T13:00:00Z`),
        endsAt: new Date(`2026-11-${date}T${index === 2 ? "21" : "22"}:00:00Z`),
      })),
    );
    const file = await fetchIcs(shop.slug, trip.id);
    const events = file.split("BEGIN:VEVENT").slice(1);
    expect(events).toHaveLength(3);
    for (const [index, event] of events.entries()) {
      expect(event).toContain(`DTSTART:202611${20 + index}T130000Z`);
      expect(event).toContain(`DTEND:202611${20 + index}T${index === 2 ? "21" : "22"}0000Z`);
    }
    expect(events[0]).toContain(trip.course.scheduleDays[0].title);
    expect(events[0]).toMatch(/confined/i);
    expect(file).not.toMatch(/Dock call|We leave|LOCATION:/);
  });

  it.each([
    { label: null, address: null, location: null },
    { label: "Training room", address: null, location: "Training room" },
    { label: null, address: "12 Ocean Drive", location: "12 Ocean Drive" },
    { label: "  ", address: "  ", location: null },
  ])(
    "keeps intro course times and only an explicitly recorded meeting place: $location",
    async ({ label, address, location }) => {
      const { db, shop, tripId } = await aDeparture(null);
      const [course] = await db.select().from(courses).where(eq(courses.shopId, shop.id)).limit(1);
      await db
        .update(courses)
        .set({
          scheduleDays: [
            {
              title: "Briefing and confined water",
              items: ["Shallow introductory dive"],
            },
          ],
        })
        .where(eq(courses.id, course.id));
      await db
        .update(trips)
        .set({ courseId: course.id, meetingPointLabel: label, meetingPointAddress: address })
        .where(eq(trips.id, tripId));
      await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, tripId));
      const file = await fetchIcs(shop.slug, tripId);
      expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(1);
      expect(file).toContain("DTSTART:20300805T130000Z");
      expect(file).toContain("DTEND:20300805T173000Z");
      expect(file).toContain("Briefing and confined water");
      expect(file).toContain("Shallow introductory dive");
      expect(file).not.toMatch(/Dock call|We leave/);
      if (location) expect(file).toContain(`LOCATION:${location}\r\n`);
      else expect(file).not.toContain("LOCATION:");
    },
  );

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

  it("has no file for a rehearsal, which has no public URL", async () => {
    const { db, shop, tripId } = await aDeparture(null);
    await db
      .update(trips)
      .set({ isRehearsal: true, isPrivate: true, priceCents: null })
      .where(eq(trips.id, tripId));
    const response = await GET(
      new Request(`https://diveday.example/s/${shop.slug}/trips/${tripId}/calendar`) as never,
      { params: Promise.resolve({ shopSlug: shop.slug, id: tripId }) },
    );
    expect(response.status).toBe(404);
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
