import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createTrip, listStaff, setTripCrew } from "./trips";
import { departuresOnWeekday, weekdayPatternFor } from "./weekday-pattern";

const ctx = fileScopedShopContext();

/** Six Saturdays before the frozen "now" below, in the seeded shop's own zone. */
const NOW = new Date("2026-08-29T20:00:00Z");
const SATURDAYS = [
  "2026-07-18",
  "2026-07-25",
  "2026-08-01",
  "2026-08-08",
  "2026-08-15",
  "2026-08-22",
];

async function putUp(date: string, startHour: number, title: string, crew: string[]) {
  const trip = await createTrip(ctx.db, {
    shopId: ctx.shop.id,
    title,
    startsAt: new Date(`${date}T${String(startHour + 4).padStart(2, "0")}:00:00Z`),
    endsAt: new Date(`${date}T${String(startHour + 7).padStart(2, "0")}:30:00Z`),
    capacity: 10,
    plannedDives: 2,
    priceCents: 9500,
  });
  if (!trip) throw new Error("createTrip refused a plain departure");
  if (crew.length > 0) await setTripCrew(ctx.db, ctx.shop.id, trip.id, crew);
  return trip;
}

/** ADR 20260906-before-you-ask, decision 3: the add panel already knows the weekday. */
describe("departuresOnWeekday", () => {
  it("reads the last six weeks of this weekday on the shop's clock, with each one's crew", async () => {
    expect(ctx.shop.timezone).toBe("America/New_York");
    const staff = await listStaff(ctx.db, ctx.shop.id);
    const [keiko, sal] = staff.map((member) => member.person.id);
    if (!keiko || !sal) throw new Error("seed has fewer than two staff");
    for (const date of SATURDAYS) await putUp(date, 7, "Two-Tank Reef", [keiko, sal]);
    // A Saturday seven weeks back is outside the window; a Sunday is not this weekday.
    await putUp("2026-07-11", 7, "Two-Tank Reef", [keiko]);
    await putUp("2026-08-23", 7, "Sunday Reef", [keiko]);

    const rows = await departuresOnWeekday(
      ctx.db,
      ctx.shop.id,
      "2026-09-05",
      ctx.shop.timezone,
      NOW,
    );
    const reef = rows.filter((row) => row.title === "Two-Tank Reef");
    expect(reef.map((row) => row.date).sort()).toEqual(SATURDAYS);
    expect(reef[0]).toMatchObject({
      startTime: "07:00",
      endTime: "10:30",
      capacity: 10,
      priceCents: 9500,
      diveMode: "boat",
    });
    expect(new Set(reef[0]?.crewPersonIds)).toEqual(new Set([keiko, sal]));
    expect(rows.some((row) => row.title === "Sunday Reef")).toBe(false);

    const pattern = await weekdayPatternFor(
      ctx.db,
      ctx.shop.id,
      "2026-09-05",
      ctx.shop.timezone,
      NOW,
    );
    expect(pattern).toMatchObject({ startTime: "07:00", title: "Two-Tank Reef" });
    expect(new Set(pattern?.crewPersonIds)).toEqual(new Set([keiko, sal]));
  });

  it("is nothing for a weekday the shop has not run three times", async () => {
    // Long before the seed's first departure, so the six weeks hold nothing.
    const then = new Date("2020-01-10T12:00:00Z");
    expect(
      await weekdayPatternFor(ctx.db, ctx.shop.id, "2020-01-08", ctx.shop.timezone, then),
    ).toBeNull();
  });
});
