import { describe, expect, it } from "vitest";
import { ACTIVITY_CODES } from "./activity";
import {
  ACTIVITY_CODE_KINDS,
  activityCodesOfKind,
  isShopActivityKind,
  SHOP_ACTIVITY_KINDS,
  shopActivityDay,
} from "./shop-activity";

describe("the activity log's kinds", () => {
  it("files every code the trail can write under exactly one kind", () => {
    const filed = SHOP_ACTIVITY_KINDS.flatMap((kind) => activityCodesOfKind(kind));
    for (const code of ACTIVITY_CODES) {
      expect(
        filed.filter((candidate) => candidate === code),
        code,
      ).toHaveLength(1);
      expect(SHOP_ACTIVITY_KINDS).toContain(ACTIVITY_CODE_KINDS[code]);
    }
  });

  it("answers the owner's questions under the kind they would look in", () => {
    expect(activityCodesOfKind("money")).toEqual(
      expect.arrayContaining([
        "order_refunded",
        "seat_refunded",
        "payment_waived",
        "payment_marked_refunded",
      ]),
    );
    // "Who wrote a seat past a missing card" is a card question, not a seat one.
    expect(ACTIVITY_CODE_KINDS.participant_type_changed).toBe("safety");
    expect(activityCodesOfKind("departures")).toEqual(
      expect.arrayContaining(["departure_moved", "departure_deleted", "series_added"]),
    );
  });

  it("reads a kind off a query parameter, and nothing else", () => {
    expect(isShopActivityKind("money")).toBe(true);
    expect(isShopActivityKind("Money")).toBe(false);
    expect(isShopActivityKind(undefined)).toBe(false);
    expect(isShopActivityKind("redacted")).toBe(false);
  });
});

describe("shopActivityDay", () => {
  it("reads a date input's value as a calendar day", () => {
    expect(shopActivityDay("2026-10-09")).toEqual({ year: 2026, month: 10, day: 9 });
  });

  it("is no filter at all for anything malformed", () => {
    for (const value of [undefined, "", "2026-13-01", "2026-00-10", "10/09/2026", "2026-10-9"]) {
      expect(shopActivityDay(value), String(value)).toBeNull();
    }
  });
});
