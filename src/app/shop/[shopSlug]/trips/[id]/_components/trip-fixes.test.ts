import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { tripFixes } from "./trip-fixes";

const t = staffTranslator("en-US");
const noWork = {
  missingSize: 0,
  kitUnasked: 0,
  ungatedNitrox: 0,
  missingContact: 0,
  openOrders: 0,
};
type Overview = Parameters<typeof tripFixes>[0];
const overview = (over: Partial<Overview> = {}): Overview =>
  ({
    pulseNeeded: true,
    cancelled: false,
    pulse: { blocked: 0, boarded: 0, work: noWork },
    crew: { crewGap: { code: "none" }, crewIds: ["sal"] },
    requirement: { minimumCertificationLevel: "open_water" },
    trip: { course: null, startsAt: new Date("2026-10-14T13:00:00Z") },
    tripDiveList: [{}],
    ...over,
  }) as unknown as Overview;
const page = {
  liveBoatClashes: [],
  phase: "ready" as const,
  shopSlug: "blue-mantis",
  tripId: "trip-1",
  now: new Date("2026-10-13T12:00:00Z"),
  t,
};

describe("tripFixes", () => {
  it("is empty for a trip that needs nothing, and for a cancelled or finished one", () => {
    expect(tripFixes(overview(), page)).toEqual([]);
    expect(tripFixes(overview({ cancelled: true, requirement: undefined }), page)).toEqual([]);
    expect(tripFixes(overview({ pulseNeeded: false, requirement: undefined }), page)).toEqual([]);
  });

  it("holds the boat up when requirements were never set, with the door to set them", () => {
    const [fix] = tripFixes(overview({ requirement: undefined }), page);
    expect(fix).toMatchObject({
      tone: "danger",
      action: { href: "/shop/blue-mantis/trips/trip-1?view=edit#requirements" },
    });
  });

  it("says a course with no instructor and a crew over ratio, each opening the crew", () => {
    const fixes = tripFixes(
      overview({ crew: { crewGap: { code: "no_instructor" }, crewIds: [] } as never }),
      page,
    );
    expect(fixes.map((fix) => [fix.key, fix.tone])).toEqual([["instructor", "danger"]]);
    expect(fixes[0]?.action.href).toContain("#crew");
  });

  it("the day before and at Check-in, names a trip with no crew or no plan", () => {
    const bare = overview({
      crew: { crewGap: { code: "none" }, crewIds: [] } as never,
      tripDiveList: [],
    });
    expect(tripFixes(bare, page).map((fix) => fix.key)).toEqual(["crew", "plan"]);
    expect(tripFixes(bare, { ...page, phase: "filling" })).toEqual([]);
  });

  it("links only filling and ready open orders to the matching unwindowed departure ledger", () => {
    const withOrders = overview({
      pulse: { blocked: 0, boarded: 0, work: { ...noWork, openOrders: 2 } } as never,
    });
    for (const phase of ["filling", "ready"] as const) {
      expect(tripFixes(withOrders, { ...page, phase })).toContainEqual({
        key: "open_orders",
        text: "2 orders awaiting payment",
        tone: "warning",
        action: {
          href: "/shop/blue-mantis/orders?tripId=trip-1&status=open&range=all",
          label: "Review in Orders",
        },
      });
    }
    for (const phase of ["checkin", "listed"] as const) {
      expect(
        tripFixes(withOrders, { ...page, phase }).some((fix) => fix.key === "open_orders"),
      ).toBe(false);
    }
  });

  it("keeps nitrox with no verified card as worth a minute, opening the Gear page", () => {
    const fixes = tripFixes(
      overview({
        pulse: { blocked: 0, boarded: 0, work: { ...noWork, ungatedNitrox: 2 } } as never,
      }),
      page,
    );
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ tone: "warning" });
    expect(fixes[0]?.action.href).toContain("/prep#");
  });
});
