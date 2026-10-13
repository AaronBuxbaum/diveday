import { describe, expect, it, vi } from "vitest";
import { createBookingParty } from "@/db/bookings";
import { rollCallEvents } from "@/db/schema";
import { createTripSeries, getTripSeriesById } from "@/db/trips";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { EVERY_WEEKDAY } from "@/lib/recurrence";
import { wallTimeToUtc } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * **"Cancel every upcoming date" says what it did** (review 2a / security D3,
 * 2026-10-12). The run stops before any date is called, so a run whose only
 * upcoming date is already underway has stopped repeating with nothing
 * cancelled: that is the partial notice, never "That series change didn't go
 * through" over a change that did.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const { cancelSeriesAction } = await import("./series-actions");

describe("cancelling a run whose only upcoming date is underway", () => {
  it("says the date still stands, not that nothing went through", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    vi.mocked(requireShopSurface).mockResolvedValue({
      session: staffSession({
        shopId: shop.id,
        shopSlug: shop.slug,
        personId: owner,
        roles: ["owner"],
      }),
    } as never);
    const date = shiftCalendarDate(calendarDateInTimezone(nowDate(), shop.timezone), 3);
    const [year, month, day] = date.split("-").map(Number);
    const startsAt = wallTimeToUtc({ year, month, day, hour: 8, minute: 0 }, shop.timezone);
    const endsAt = wallTimeToUtc({ year, month, day, hour: 12, minute: 0 }, shop.timezone);
    const series = await createTripSeries(db, {
      shopId: shop.id,
      title: "One Last Run",
      capacity: 8,
      plannedDives: 2,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: EVERY_WEEKDAY,
      anchorDate: date,
      endsOn: date,
      timeZone: shop.timezone,
      template: { startsAt, endsAt },
    });
    const [only] = series?.trips ?? [];
    if (!series || !only) throw new Error("series not created");
    const party = await createBookingParty(db, [
      {
        actor: "staff" as const,
        shopId: shop.id,
        tripId: only.id,
        fullName: "Early Boarder",
        email: "early.boarder@example.com",
      },
    ]);
    if (!party.ok) throw new Error("could not book the date");
    // Boarding has begun: the date is underway and cannot be called off.
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: only.id,
      bookingId: party.bookings[0]?.bookingId as string,
      recordedByPersonId: owner,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: nowDate(),
    });

    const to = await redirectedTo(() => cancelSeriesAction(shop.slug, only.id, series.series.id));
    expect(to).toContain("notice=series-cancelled-partly");
    expect(to).not.toContain("series-error");
    // The repeat did stop, which is what the notice owes the staffer.
    expect((await getTripSeriesById(db, shop.id, series.series.id))?.endsOn).not.toBeNull();
  });
});
