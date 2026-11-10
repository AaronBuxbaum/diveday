import { describe, expect, it } from "vitest";
import { groupHoldCheckoutDeadline, groupHoldDeadline, groupSeatSettled } from "./group-holds";

const now = new Date("2026-11-10T12:00:00Z");
const tomorrow = new Date("2026-11-11T12:00:00Z");
describe("group hold rules", () => {
  it("caps a hold at one day, or the departure if sooner", () => {
    expect(groupHoldDeadline(now, new Date("2026-11-12T12:00:00Z"))).toEqual(tomorrow);
    expect(groupHoldDeadline(now, new Date("2026-11-10T18:00:00Z"))).toEqual(
      new Date("2026-11-10T18:00:00Z"),
    );
    expect(groupHoldDeadline(now, tomorrow, new Date("2026-11-10T13:00:00Z"))).toEqual(
      new Date("2026-11-10T13:00:00Z"),
    );
  });
  it("refuses nonfuture and invalid instants", () => {
    expect(groupHoldDeadline(now, now)).toBeNull();
    expect(groupHoldDeadline(now, tomorrow, new Date("invalid"))).toBeNull();
    expect(groupHoldDeadline(now, tomorrow, new Date(0))).toBeNull();
  });
  it("requires captured money or an explicit waiver to keep the seat", () => {
    for (const status of ["paid", "deposit_paid", "partly_refunded", "waived"])
      expect(groupSeatSettled(status)).toBe(true);
    for (const status of [null, "pending", "unpaid", "refunded"])
      expect(groupSeatSettled(status)).toBe(false);
  });
});

describe("group hold hosted checkout deadline", () => {
  it("takes the earliest held deadline and leaves ordinary seats uncapped", () => {
    expect(groupHoldCheckoutDeadline([null, tomorrow], now)).toEqual(tomorrow);
    expect(groupHoldCheckoutDeadline([null], now)).toBeUndefined();
    expect(groupHoldCheckoutDeadline([new Date(now.getTime() + 30 * 60_000)], now)).toBeNull();
    expect(
      groupHoldCheckoutDeadline([new Date(now.getTime() + 31 * 60_000), tomorrow], now),
    ).toEqual(new Date(now.getTime() + 31 * 60_000));
  });
});
