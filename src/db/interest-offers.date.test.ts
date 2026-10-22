import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import type { Notification } from "@/lib/notifications/kinds";
import { fileScopedShopContext } from "@/test/db";
import { addInterest } from "./interest-dates-fixtures";

const ctx = fileScopedShopContext();

/**
 * **Offering a seat to a date request** (ADR 20261017-one-interest-with-a-scope):
 * the panel's "Asked for this date" rows go through the same `offerSeats` as
 * the wait list. An offer is always a departure row, so the request is copied
 * to one (`parent_interest_id`), keeping the snapshot a person-less request was
 * made with; the send is the reply to what they asked, which is service mail.
 */
vi.mock("./notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./notifications")>();
  return { ...actual, sendNotification: vi.fn() };
});
vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return { ...actual, publicAppUrl: () => "https://dive.day" };
});

const { sendNotification } = await import("./notifications");
const { offerSeats } = await import("./interest-offers");
const { listDateInterestsInReach } = await import("./interest-dates");
const { interests } = await import("./schema");
const { upcomingTripsWithCounts } = await import("./trips");

async function context() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!trip) throw new Error("expected seeded trip missing");
  return { db, shop, trip, day: calendarDateInTimezone(trip.startsAt, shop.timezone) };
}

function mail(): Notification[] {
  return vi.mocked(sendNotification).mock.calls.map((call) => call[1]);
}

describe("offerSeats to a date request", () => {
  beforeEach(() => {
    vi.mocked(sendNotification).mockReset();
    vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m-1" });
  });

  it("copies a person-less request to a departure row with its snapshot, and replies as service mail", async () => {
    const { db, shop, trip, day } = await context();
    const requestId = await addInterest(db, shop.id, {
      interest: "night dive",
      preferredDate: day,
      name: "Eli Moss",
      email: "eli@example.com",
    });

    const outcome = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      interestIds: [requestId],
    });

    expect(outcome.results).toEqual([{ interestId: requestId, delivery: "sent" }]);
    const [child] = await db
      .select()
      .from(interests)
      .where(and(eq(interests.scope, "departure"), eq(interests.tripId, trip.id)));
    expect(child).toMatchObject({
      parentInterestId: requestId,
      askedBy: "diver",
      personId: null,
      name: "Eli Moss",
      email: "eli@example.com",
    });
    expect(child?.offeredAt).not.toBeNull();
    // The request itself is untouched: still open, still a date interest.
    const [parent] = await db.select().from(interests).where(eq(interests.id, requestId));
    expect(parent).toMatchObject({ scope: "date", closedAt: null });
    expect(mail().map((note) => note.kind)).toEqual(["seat_offer"]);

    // The panel reads "offered" off the child.
    const [row] = await listDateInterestsInReach(db, shop.id, { tripId: trip.id });
    expect(row).toMatchObject({ id: requestId, departureInterestId: child?.id });
    expect(row?.offeredAt).not.toBeNull();
  });

  it("offers a request once: a second offer reuses the child row", async () => {
    const { db, shop, trip, day } = await context();
    const requestId = await addInterest(db, shop.id, {
      interest: "night dive",
      preferredDate: day,
      email: "eli@example.com",
      name: "Eli Moss",
    });
    const offer = () =>
      offerSeats(db, {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        interestIds: [requestId],
      });
    await offer();
    await offer();
    const children = await db
      .select()
      .from(interests)
      .where(eq(interests.parentInterestId, requestId));
    expect(children).toHaveLength(1);
  });

  it("offers nothing to a request that cannot make the day, whatever was posted", async () => {
    const { db, shop, trip, day } = await context();
    const requestId = await addInterest(db, shop.id, {
      interest: "night dive",
      preferredDate: shiftCalendarDate(day, 30),
      email: "far@example.com",
      name: "Far Off",
    });
    const outcome = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      interestIds: [requestId],
    });
    expect(outcome.results).toEqual([{ interestId: requestId, delivery: "fallback" }]);
    expect(
      await db.select().from(interests).where(eq(interests.parentInterestId, requestId)),
    ).toEqual([]);
    expect(mail()).toEqual([]);
  });
});
