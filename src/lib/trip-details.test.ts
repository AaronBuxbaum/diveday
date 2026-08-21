import { describe, expect, it } from "vitest";
import { type TripDetailsFields, type TripDetailsShop, tripDetailsPatch } from "./trip-details";

const shop: TripDetailsShop = {
  // Chosen deliberately: US Eastern observes DST, so a two-day trip across the
  // March change is a real test rather than an arithmetic one.
  timezone: "America/New_York",
  currency: "USD",
  hasBoatDiving: true,
  hasShoreDiving: true,
  hasPoolDiving: false,
};

const base: TripDetailsFields = {
  date: "2026-06-10",
  startTime: "07:30",
  endTime: "12:30",
  dayCount: 1,
};

function ok(fields: Partial<TripDetailsFields> = {}, s: TripDetailsShop = shop) {
  const result = tripDetailsPatch({ ...base, ...fields }, s);
  if (!result.ok) throw new Error(`expected a patch, got refusal: ${result.reason}`);
  return result.patch;
}

function refusal(fields: Partial<TripDetailsFields> = {}, s: TripDetailsShop = shop) {
  const result = tripDetailsPatch({ ...base, ...fields }, s);
  if (result.ok) throw new Error("expected a refusal, got a patch");
  return result.reason;
}

describe("the wall-clock window", () => {
  it("converts the shop's wall time to the instant it actually happens", () => {
    const patch = ok();
    expect(patch.startsAt.toISOString()).toBe("2026-06-10T11:30:00.000Z");
    expect(patch.endsAt.toISOString()).toBe("2026-06-10T16:30:00.000Z");
  });

  it("refuses an end at or before the start, distinguishably", () => {
    expect(refusal({ endTime: "07:30" })).toBe("end_before_start");
    expect(refusal({ endTime: "06:00" })).toBe("end_before_start");
  });

  it("refuses a day the calendar does not have", () => {
    // The board already refused this; the trip edit form did not. A series
    // stores this string as the anchor its whole cadence counts from.
    expect(refusal({ date: "2026-02-31" })).toBe("invalid");
    expect(refusal({ date: "2026-13-01" })).toBe("invalid");
    expect(refusal({ date: "not-a-date" })).toBe("invalid");
  });

  it("refuses a malformed time", () => {
    expect(refusal({ startTime: "7:30" })).toBe("invalid");
  });
});

describe("a multi-day trip straddling a DST change", () => {
  /**
   * 2026-03-08 is the US spring-forward. A shop promising "in the water at
   * 07:30, back at the dock at 12:30" promises that on *both* days — so the two
   * days are converted on their own dates and the UTC instants differ by an
   * hour, rather than day two inheriting day one's offset.
   */
  it("keeps the wall-clock time the shop promised on both days", () => {
    const patch = ok({ date: "2026-03-07", dayCount: 2 });

    expect(patch.scheduleDays).toHaveLength(2);
    expect(patch.scheduleDays[0]?.startsAt.toISOString()).toBe("2026-03-07T12:30:00.000Z");
    expect(patch.scheduleDays[1]?.startsAt.toISOString()).toBe("2026-03-08T11:30:00.000Z");

    const [dayOne, dayTwo] = patch.scheduleDays;
    const hoursApart =
      ((dayTwo?.startsAt.getTime() ?? 0) - (dayOne?.startsAt.getTime() ?? 0)) / 3_600_000;
    expect(hoursApart).toBe(23);
  });

  it("spans the whole departure: day one's departure to the last day's return", () => {
    const patch = ok({ date: "2026-03-07", dayCount: 2 });
    expect(patch.startsAt).toEqual(patch.scheduleDays[0]?.startsAt);
    expect(patch.endsAt).toEqual(patch.scheduleDays[1]?.endsAt);
  });

  it("numbers the days from one", () => {
    expect(ok({ dayCount: 3 }).scheduleDays.map((day) => day.dayNumber)).toEqual([1, 2, 3]);
  });

  it("refuses a day count outside the supported range", () => {
    expect(refusal({ dayCount: 0 })).toBe("invalid");
    expect(refusal({ dayCount: 99 })).toBe("invalid");
  });
});

describe("the price boxes", () => {
  it("reads the numbers in the shop's own currency", () => {
    const patch = ok({ priceDollars: 120, depositDollars: 25 });
    expect(patch.priceCents).toBe(12_000);
    expect(patch.depositCents).toBe(2_500);
  });

  it("stores a zero-decimal currency without the hundredfold", () => {
    // 5000 in a JPY shop's price box is 5,000 yen and stores 5000.
    const patch = ok({ priceDollars: 5000 }, { ...shop, currency: "JPY" });
    expect(patch.priceCents).toBe(5000);
  });

  it("leaves an empty box null rather than zero", () => {
    const patch = ok();
    expect(patch.priceCents).toBeNull();
    expect(patch.depositCents).toBeNull();
  });

  it("refuses a price above the ceiling every other validator applies", () => {
    // Checked on converted minor units, not the typed number — the form schemas
    // are module-level and parse before the shop's currency is known.
    expect(refusal({ priceDollars: 100_000_000 })).toBe("invalid");
    expect(refusal({ depositDollars: 100_000_000 })).toBe("invalid");
  });
});

describe("the free-cancellation policy", () => {
  it("keeps a decision window that has a minimum beside it", () => {
    const patch = ok({ minimumBookings: 4, minimumDecisionHours: 48 });
    expect(patch.minimumBookings).toBe(4);
    expect(patch.minimumDecisionHours).toBe(48);
  });

  /**
   * The divergence this module was extracted to close. The board refused to
   * create a window with no minimum beside it; the trip edit form wrote one
   * unconditionally, so a departure created coherently could be edited into
   * exactly the state the board refuses.
   */
  it("drops a decision window with no minimum beside it", () => {
    const patch = ok({ minimumDecisionHours: 48 });
    expect(patch.minimumBookings).toBeNull();
    expect(patch.minimumDecisionHours).toBeNull();
  });

  it("drops the window when the minimum is cleared to zero", () => {
    expect(ok({ minimumBookings: 0, minimumDecisionHours: 48 }).minimumDecisionHours).toBeNull();
  });

  it("passes the cancellation window through, blank as null", () => {
    expect(ok({ cancellationWindowHours: 24 }).cancellationWindowHours).toBe(24);
    expect(ok().cancellationWindowHours).toBeNull();
  });
});

describe("the hull a departure sails on", () => {
  it("takes the submitted mode when the shop runs it", () => {
    const patch = ok({ diveMode: "shore" });
    expect(patch.diveMode).toBe("shore");
    expect(patch.boatId).toBeNull();
  });

  it("assigns a boat only to a boat departure", () => {
    expect(ok({ diveMode: "boat", boatId: "boat-1" }).boatId).toBe("boat-1");
    expect(ok({ diveMode: "shore", boatId: "boat-1" }).boatId).toBeNull();
  });

  /**
   * The builder's dive-mode select is populated by an options fetch that lands
   * after first paint, so for a moment the form carries `boat`. A shore-only
   * shop submitting in that window must not put a departure on a hull it has
   * told us it does not run — and nor may a hand-crafted post.
   */
  it("overrides a mode the shop does not run with one it does", () => {
    const shoreOnly = { ...shop, hasBoatDiving: false, hasShoreDiving: true };
    const patch = ok({ diveMode: "boat", boatId: "boat-1" }, shoreOnly);
    expect(patch.diveMode).toBe("shore");
    expect(patch.boatId).toBeNull();
  });

  it("says nothing about the hull when the form has no dive-mode box", () => {
    // The trip edit form: an edit leaves the departure on whatever it sails on,
    // and must not write a default over the shop's own answer.
    const patch = ok();
    expect(patch).not.toHaveProperty("diveMode");
    expect(patch).not.toHaveProperty("boatId");
  });
});
