import { describe, expect, it } from "vitest";
import {
  ACTIVATION_PATH,
  activationStall,
  countDiveDays,
  currentWeek,
  type DepartureRollCallEvent,
  isDigestDay,
  previousWeek,
  rankSources,
  STALL_DAYS,
} from "./founder-metrics";

const DAY = 86_400_000;
const now = new Date("2026-10-12T11:00:00.000Z"); // a Monday
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

describe("activationStall", () => {
  it("is quiet for a shop that took its last step less than a week ago", () => {
    expect(
      activationStall({ shop_created: daysAgo(20), first_departure: daysAgo(STALL_DAYS - 1) }, now),
    ).toBeNull();
  });

  it("reports a shop sitting seven days after its last step, and what it waits for", () => {
    expect(
      activationStall({ shop_created: daysAgo(20), first_departure: daysAgo(STALL_DAYS) }, now),
    ).toEqual({
      lastReached: "first_departure",
      since: daysAgo(STALL_DAYS),
      waitingFor: "first_public_booking",
    });
  });

  it("reports a shop that never scheduled anything", () => {
    expect(activationStall({ shop_created: daysAgo(9) }, now)).toMatchObject({
      lastReached: "shop_created",
      waitingFor: "first_departure",
    });
  });

  it("dates the stall from the most recent step even when steps came out of order", () => {
    // A staff-seated diver signed a waiver before any public booking arrived.
    const stall = activationStall(
      {
        shop_created: daysAgo(30),
        first_departure: daysAgo(25),
        first_signed_waiver: daysAgo(3),
      },
      now,
    );
    expect(stall).toBeNull();

    expect(
      activationStall(
        {
          shop_created: daysAgo(30),
          first_departure: daysAgo(25),
          first_signed_waiver: daysAgo(8),
        },
        now,
      ),
    ).toEqual({
      lastReached: "first_signed_waiver",
      since: daysAgo(8),
      waitingFor: "first_public_booking",
    });
  });

  it("has nothing to say about a shop that finished the path", () => {
    const done = Object.fromEntries(ACTIVATION_PATH.map((step) => [step, daysAgo(60)]));
    expect(activationStall(done, now)).toBeNull();
  });

  it("never waits on the billing seam, which nothing writes yet", () => {
    expect(ACTIVATION_PATH).not.toContain("first_paid_month");
  });

  it("has no stall to report for a shop with no recorded step at all", () => {
    expect(activationStall({}, now)).toBeNull();
  });
});

describe("digest weeks", () => {
  it("reports the last complete Monday-to-Sunday week on a Monday", () => {
    expect(previousWeek(now)).toEqual({
      startDate: "2026-10-05",
      endDate: "2026-10-11",
      startsAt: new Date("2026-10-05T00:00:00.000Z"),
      endsAt: new Date("2026-10-12T00:00:00.000Z"),
    });
  });

  it("reads the week so far from any day in it, Sunday included", () => {
    const sunday = new Date("2026-10-18T23:30:00.000Z");
    expect(currentWeek(sunday).startDate).toBe("2026-10-12");
    expect(currentWeek(sunday).endDate).toBe("2026-10-18");
    expect(previousWeek(sunday).startDate).toBe("2026-10-05");
  });

  it("sends on Mondays only", () => {
    expect(isDigestDay(now)).toBe(true);
    expect(isDigestDay(new Date("2026-10-13T11:00:00.000Z"))).toBe(false);
    expect(isDigestDay(new Date("2026-10-11T23:59:00.000Z"))).toBe(false);
  });
});

describe("rankSources", () => {
  it("puts the biggest door first, breaks ties by name and drops empty rows", () => {
    expect(
      rankSources([
        { source: "pricing", count: 2 },
        { source: "home-hero", count: 5 },
        { source: "about-rules", count: 2 },
        { source: "nav", count: 0 },
      ]),
    ).toEqual([
      { source: "home-hero", count: 5 },
      { source: "about-rules", count: 2 },
      { source: "pricing", count: 2 },
    ]);
  });
});

describe("countDiveDays", () => {
  const at = (iso: string) => new Date(iso);
  const event = (over: Partial<DepartureRollCallEvent>): DepartureRollCallEvent => ({
    shopId: "shop-a",
    bookingId: "b1",
    localDay: "2026-10-10",
    status: "boarded",
    occurredAt: at("2026-10-10T12:00:00Z"),
    createdAt: at("2026-10-10T12:00:00Z"),
    seq: 1,
    ...over,
  });

  it("counts one dive day per shop per local day, however many divers boarded", () => {
    expect(
      countDiveDays([
        event({ bookingId: "b1" }),
        event({ bookingId: "b2", seq: 2 }),
        event({ bookingId: "b3", localDay: "2026-10-11", seq: 3 }),
        event({ shopId: "shop-b", bookingId: "b4", seq: 4 }),
      ]),
    ).toEqual({ diveDays: 3, shops: 2 });
  });

  it("does not count a day whose only boarding was undone or corrected", () => {
    expect(
      countDiveDays([
        event({ bookingId: "b1", seq: 1 }),
        event({ bookingId: "b1", status: "cleared", seq: 2 }),
        event({ bookingId: "b2", seq: 3, localDay: "2026-10-11" }),
        event({ bookingId: "b2", status: "not_boarded", seq: 4, localDay: "2026-10-11" }),
      ]),
    ).toEqual({ diveDays: 0, shops: 0 });
  });

  it("reads the newest event by occurred, then created, then seq, whatever order rows arrive in", () => {
    expect(
      countDiveDays([
        event({
          bookingId: "b1",
          status: "boarded",
          seq: 9,
          occurredAt: at("2026-10-10T12:05:00Z"),
        }),
        event({
          bookingId: "b1",
          status: "cleared",
          seq: 10,
          occurredAt: at("2026-10-10T12:00:00Z"),
        }),
      ]),
    ).toEqual({ diveDays: 1, shops: 1 });
    expect(
      countDiveDays([
        event({ bookingId: "b1", status: "cleared", seq: 10 }),
        event({ bookingId: "b1", status: "boarded", seq: 9 }),
      ]),
    ).toEqual({ diveDays: 0, shops: 0 });
  });

  it("is zero for a week with no departure roll call at all", () => {
    expect(countDiveDays([])).toEqual({ diveDays: 0, shops: 0 });
  });
});
