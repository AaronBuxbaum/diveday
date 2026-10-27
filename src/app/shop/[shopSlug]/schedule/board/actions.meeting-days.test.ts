import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { tripScheduleDays, trips } from "@/db/schema";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { addCalendarDays, utcToWallTime } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * **A departure's days, named one by one.** Day one is the departure's date and
 * each later day is its own date, one departure, one roster, one certify. For
 * now the days run back to back (`MAX_MEETING_DAY_GAP_DAYS`): Today and the
 * roll call read a departure as one window, so a gap would read as days on the
 * water. Days must run forward, and a repeating departure must end before its
 * next one begins.
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
const { addDepartureAction } = await import("./actions");

const pad = (value: number) => String(value).padStart(2, "0");
const TITLE = "Open Water weekends";

async function signedInOwner() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    db,
    shop,
  } as never);
  return { db, shop };
}

function dayAfterStart(timeZone: string, offset: number) {
  const first = utcToWallTime(new Date(nowDate().getTime() + 10 * 24 * 60 * 60 * 1000), timeZone);
  const day = addCalendarDays(first, offset);
  return `${day.year}-${pad(day.month)}-${pad(day.day)}`;
}

function courseForm(timeZone: string, laterOffsets: number[], extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    title: TITLE,
    date: dayAfterStart(timeZone, 0),
    startTime: "09:00",
    endTime: "13:00",
    capacity: "6",
    plannedDives: "2",
    priceDollars: "450",
    dayCount: String(laterOffsets.length + 1),
    ...extra,
  })) {
    form.set(key, value);
  }
  for (const offset of laterOffsets) form.append("meetingDate", dayAfterStart(timeZone, offset));
  return form;
}

async function departures(db: Awaited<ReturnType<typeof signedInOwner>>["db"], shopId: string) {
  return db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.title, TITLE)));
}

describe("adding a course that meets on named days", () => {
  it("puts one departure on the board with a day on each named date", async () => {
    const { db, shop } = await signedInOwner();
    const form = courseForm(shop.timezone, [1, 2]);
    expect(await redirectedTo(() => addDepartureAction(shop.slug, form))).toContain(
      "builder=added",
    );
    const added = await departures(db, shop.id);
    expect(added).toHaveLength(1);
    const days = await db
      .select({ startsAt: tripScheduleDays.startsAt })
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, added[0].id))
      .orderBy(asc(tripScheduleDays.dayNumber));
    expect(days.map((day) => calendarDateInTimezone(day.startsAt, shop.timezone))).toEqual([
      dayAfterStart(shop.timezone, 0),
      dayAfterStart(shop.timezone, 1),
      dayAfterStart(shop.timezone, 2),
    ]);
  });

  it("refuses a forged five-dive ordinary departure or an unknown course", async () => {
    const { db, shop } = await signedInOwner();
    for (const courseId of ["", "00000000-0000-4000-8000-000000000000"]) {
      const form = courseForm(shop.timezone, [1], { plannedDives: "5", courseId });
      expect(await redirectedTo(() => addDepartureAction(shop.slug, form))).toContain(
        "builder=invalid",
      );
      expect(await departures(db, shop.id)).toEqual([]);
    }
  });

  it("refuses a course with two weeks between its days and adds nothing", async () => {
    const { db, shop } = await signedInOwner();
    const form = courseForm(shop.timezone, [14]);
    expect(await redirectedTo(() => addDepartureAction(shop.slug, form))).toContain(
      "builder=days-out-of-order",
    );
    expect(await departures(db, shop.id)).toEqual([]);
  });

  it("refuses days that do not run forward and adds nothing", async () => {
    const { db, shop } = await signedInOwner();
    const form = courseForm(shop.timezone, [2, 1]);
    expect(await redirectedTo(() => addDepartureAction(shop.slug, form))).toContain(
      "builder=days-out-of-order",
    );
    expect(await departures(db, shop.id)).toEqual([]);
  });

  it("refuses a weekly departure whose days run into next week's", async () => {
    const { db, shop } = await signedInOwner();
    const form = courseForm(shop.timezone, [1, 2, 3, 4, 5, 6, 7], {
      repeatIntervalWeeks: "1",
      repeatWeekday: "0",
    });
    expect(await redirectedTo(() => addDepartureAction(shop.slug, form))).toContain(
      "builder=days-span-repeat",
    );
    expect(await departures(db, shop.id)).toEqual([]);
  });
});
