import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { boats, trips } from "@/db/schema";
import { createTrip } from "@/db/trips";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { wallTimeToUtc } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";
import { createBoat } from "../../../../../features/boats/store";

const ctx = fileScopedShopContext();

/**
 * **Every builder door refuses a hull in the yard** (issue #3915), with the
 * add path's own `builder=boat-out-of-service` notice: a drag to another day,
 * a copy, and a weekly series whose later week lands in the window. The
 * board's warning was the only thing that caught these before.
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
vi.mock("../../../../../features/session/rules", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("../../../../../features/session/rules");
const { addDepartureAction, duplicateDepartureAction, moveDepartureAction } = await import(
  "./actions"
);

/** Days from today, as the shop's own calendar date. */
function dayFromNow(timeZone: string, days: number) {
  return shiftCalendarDate(calendarDateInTimezone(nowDate(), timeZone), days);
}

async function ownerWithHullInTheYard() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    db,
    shop,
  } as never);
  const boat = await createBoat(db, shop.id, "Hull B", 12);
  // In the yard three days, a fortnight out.
  await db
    .update(boats)
    .set({
      outOfServiceFrom: dayFromNow(shop.timezone, 17),
      outOfServiceUntil: dayFromNow(shop.timezone, 19),
      outOfServiceReason: "Bottom paint",
    })
    .where(eq(boats.id, boat.id));
  const [year, month, day] = dayFromNow(shop.timezone, 10).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const startsAt = wallTimeToUtc({ year, month, day, hour: 8, minute: 0 }, shop.timezone);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Two-tank on Hull B",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
    capacity: 10,
    boatId: boat.id,
  });
  if (!trip) throw new Error("trip missing");
  return { db, shop, boat, trip };
}

function form(fields: Record<string, string>, repeats: Record<string, string[]> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  for (const [key, values] of Object.entries(repeats)) {
    for (const value of values) data.append(key, value);
  }
  return data;
}

async function departuresOn(db: typeof ctx.db, boatId: string) {
  return db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.boatId, boatId), isNull(trips.deletedAt)));
}

describe("a hull in the yard, at every builder door", () => {
  it("refuses a drag onto a day in the window and leaves the departure put", async () => {
    const { db, shop, boat, trip } = await ownerWithHullInTheYard();
    const to = await redirectedTo(() =>
      moveDepartureAction(
        shop.slug,
        form({ tripId: trip.id, date: dayFromNow(shop.timezone, 18), startTime: "08:00" }),
      ),
    );
    expect(to).toContain("builder=boat-out-of-service");
    // Issue #4026: the notice names the yard day.
    expect(to).toContain(`on=${dayFromNow(shop.timezone, 18)}`);
    expect(await departuresOn(db, boat.id)).toEqual([{ id: trip.id, startsAt: trip.startsAt }]);
  });

  it("refuses a copy onto the last day of the window", async () => {
    const { db, shop, boat, trip } = await ownerWithHullInTheYard();
    const to = await redirectedTo(() =>
      duplicateDepartureAction(
        shop.slug,
        form({ tripId: trip.id, date: dayFromNow(shop.timezone, 19), startTime: "08:00" }),
      ),
    );
    expect(to).toContain("builder=boat-out-of-service");
    expect(await departuresOn(db, boat.id)).toHaveLength(1);
  });

  it("still copies onto the day after the window", async () => {
    const { db, shop, boat, trip } = await ownerWithHullInTheYard();
    const to = await redirectedTo(() =>
      duplicateDepartureAction(
        shop.slug,
        form({ tripId: trip.id, date: dayFromNow(shop.timezone, 20), startTime: "08:00" }),
      ),
    );
    expect(to).toContain("builder=copied");
    expect(await departuresOn(db, boat.id)).toHaveLength(2);
  });

  // Issues #4009, #4026: the single add asks in its write and names the day.
  it("refuses a single add on the window's first day, naming it", async () => {
    const { db, shop, boat } = await ownerWithHullInTheYard();
    const day = dayFromNow(shop.timezone, 17);
    const to = await redirectedTo(() =>
      addDepartureAction(
        shop.slug,
        form({
          title: "One more on Hull B",
          date: day,
          startTime: "08:00",
          endTime: "12:00",
          capacity: "10",
          plannedDives: "2",
          diveMode: "boat",
          boatId: boat.id,
        }),
      ),
    );
    expect(to).toContain("builder=boat-out-of-service");
    expect(to).toContain(`on=${day}`);
    expect(await departuresOn(db, boat.id)).toHaveLength(1);
  });

  it("refuses a weekly series whose second week lands in the window, and adds no week", async () => {
    const { db, shop, boat } = await ownerWithHullInTheYard();
    const anchor = dayFromNow(shop.timezone, 11);
    const [year, month, day] = anchor.split("-").map(Number) as [number, number, number];
    // The anchor's own weekday, read off the calendar date alone.
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const to = await redirectedTo(() =>
      addDepartureAction(
        shop.slug,
        form(
          {
            title: "Weekly on Hull B",
            date: anchor,
            startTime: "08:00",
            endTime: "12:00",
            capacity: "10",
            plannedDives: "2",
            diveMode: "boat",
            boatId: boat.id,
            repeatIntervalWeeks: "1",
          },
          { repeatWeekday: [String(weekday)] },
        ),
      ),
    );
    // The notice names the week that refused, which may be months out.
    expect(to).toContain("builder=series-boat-out-of-service");
    expect(to).toContain(`on=${dayFromNow(shop.timezone, 18)}`);
    expect(await departuresOn(db, boat.id)).toHaveLength(1);
  });
});
