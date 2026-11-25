import { and, eq, gt } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { issuePreview } from "@/features/demo/demo-preview";
import { nowDate } from "@/lib/clock";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { unseededTestDb } from "@/test/db";
import { boats, shops, tripScheduleDays, trips } from "../schema";
import { DEMO_SHOP_TIMEZONE } from "./clock";
import { resetDemoSchedule } from "./index";
import { PREVIEW_SAMPLE_BOATS, type PreviewDayTrip, planPreviewDay } from "./preview-day";

const ZONE = DEMO_SHOP_TIMEZONE;
/** 9:30 AM shop time on a Tuesday. */
const NOW = wallTimeToUtc({ year: 2026, month: 7, day: 21, hour: 9, minute: 30 }, ZONE);

function at(day: number, hour: number, minute = 0): Date {
  return wallTimeToUtc({ year: 2026, month: 7, day, hour, minute }, ZONE);
}

function trip(id: string, from: Date, to: Date, overrides: Partial<PreviewDayTrip> = {}) {
  return { id, boatId: "boat-1", startsAt: from, endsAt: to, movable: true, ...overrides };
}

function clockOf(date: Date): string {
  const wall = utcToWallTime(date, ZONE);
  return `${wall.day} ${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
}

describe("planPreviewDay", () => {
  it("moves each day boat to the prospect's nearest time that day, keeping its length", () => {
    const moves = planPreviewDay(
      [trip("morning", at(22, 7), at(22, 10, 30)), trip("afternoon", at(22, 14, 30), at(22, 18))],
      ["08:30", "13:00"],
      NOW,
      ZONE,
    );
    expect(moves.map((m) => [m.id, clockOf(m.startsAt), clockOf(m.endsAt)])).toEqual([
      ["morning", "22 08:30", "22 12:00"],
      ["afternoon", "22 13:00", "22 16:30"],
    ]);
  });

  it("leaves a boat already at a prospect's time, the dawn boat, the night dive and a far one", () => {
    const moves = planPreviewDay(
      [
        trip("on-time", at(22, 8, 30), at(22, 12)),
        trip("dawn", at(23, 5, 30), at(23, 8, 30)),
        trip("night", at(23, 19, 30), at(23, 23)),
        trip("far", at(24, 13), at(24, 16)),
      ],
      ["08:30"],
      NOW,
      ZONE,
    );
    expect(moves).toEqual([]);
  });

  it("never moves a departure that sailed, one marked to stay, or one onto a time already past", () => {
    const moves = planPreviewDay(
      [
        trip("sailing", at(21, 7), at(21, 10, 30)),
        trip("course", at(22, 9), at(22, 12), { movable: false }),
        trip("soon", at(21, 10), at(21, 13), { boatId: "boat-2" }),
      ],
      ["08:30"],
      NOW,
      ZONE,
    );
    expect(moves).toEqual([]);
  });

  it("takes the next nearest time when the nearest has passed today", () => {
    const moves = planPreviewDay(
      [trip("soon", at(21, 10), at(21, 13))],
      ["08:30", "12:30"],
      NOW,
      ZONE,
    );
    expect(moves.map((m) => clockOf(m.startsAt))).toEqual(["21 12:30"]);
  });

  it("never puts one hull on two departures at once", () => {
    const moves = planPreviewDay(
      [
        trip("first", at(22, 8), at(22, 11, 30)),
        trip("second", at(22, 10), at(22, 13, 30)),
        trip("other-hull", at(22, 10), at(22, 13, 30), { boatId: "boat-2" }),
      ],
      ["09:00"],
      NOW,
      ZONE,
    );
    expect(moves.map((m) => m.id)).toEqual(["other-hull"]);
  });

  it("changes nothing without the prospect's times", () => {
    expect(planPreviewDay([trip("morning", at(22, 7), at(22, 10))], [], NOW, ZONE)).toEqual([]);
  });
});

describe("a preview shop's day", () => {
  it("sails its day boats at the prospect's times on hulls with the prospect's names, through a reset", async () => {
    const db = await unseededTestDb();
    const now = nowDate();
    const preview = await issuePreview(
      db,
      {
        name: "Reef Line Divers",
        site: null,
        brandColor: null,
        tagline: null,
        locality: null,
        region: null,
        position: null,
        departureTimes: ["08:30", "13:00"],
        boatNames: ["Reef Runner", "Sea Hunter"],
      },
      now,
    );
    const [shop] = await db.select().from(shops).where(eq(shops.id, preview.demoShopId));

    const look = async () => {
      const names = (
        await db.select({ name: boats.name }).from(boats).where(eq(boats.shopId, shop.id))
      )
        .map((row) => row.name)
        .sort();
      const upcoming = await db
        .select({
          id: trips.id,
          status: trips.status,
          startsAt: trips.startsAt,
          courseId: trips.courseId,
        })
        .from(trips)
        // diveday:allow-deleted-trips: a freshly seeded shop has deleted nothing.
        .where(and(eq(trips.shopId, shop.id), gt(trips.startsAt, now)));
      const times = upcoming
        .filter((row) => row.courseId === null && row.status === "scheduled")
        .map((row) => {
          const wall = utcToWallTime(row.startsAt, shop.timezone);
          return `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
        });
      return { names, times, upcoming };
    };

    const built = await look();
    expect(built.names).toEqual(["Reef Runner", "Sea Hunter"]);
    // The sample day's 7:00, 11:00 and 11:30 day boats are gone; its night
    // and sunset sailings keep their hours, and so does a boat whose desk has
    // already checked somebody in.
    expect(built.times).toContain("08:30");
    expect(built.times).toContain("13:00");
    expect(built.times).toContain("19:30");
    for (const time of ["07:00", "11:00", "11:30"]) expect(built.times).not.toContain(time);

    // A day boat's one schedule day moved with it.
    const moved = built.upcoming.find((row) => row.courseId === null);
    if (moved) {
      const [day] = await db
        .select()
        .from(tripScheduleDays)
        .where(eq(tripScheduleDays.tripId, moved.id));
      if (day) expect(day.startsAt.getTime()).toBe(moved.startsAt.getTime());
    }

    await resetDemoSchedule(db, shop.id, "history");
    const reset = await look();
    expect(reset.names).toEqual(["Reef Runner", "Sea Hunter"]);
    expect(reset.times).toContain("08:30");
    for (const time of ["07:00", "11:00", "11:30"]) expect(reset.times).not.toContain(time);
  }, 240_000);

  it("leaves every other demo shop's boats and times as the sample has them", async () => {
    const db = await unseededTestDb();
    const preview = await issuePreview(
      db,
      {
        name: "Reef Line Divers",
        site: null,
        brandColor: null,
        tagline: null,
        locality: null,
        region: null,
        position: null,
        departureTimes: [],
        boatNames: [],
      },
      nowDate(),
    );
    const names = (
      await db.select({ name: boats.name }).from(boats).where(eq(boats.shopId, preview.demoShopId))
    )
      .map((row) => row.name)
      .sort();
    expect(names).toEqual([...PREVIEW_SAMPLE_BOATS]);
  }, 240_000);
});
