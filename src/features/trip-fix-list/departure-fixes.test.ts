import { describe, expect, it } from "vitest";
import { openOrdersFix } from "./departure-fixes";

describe("openOrdersFix", () => {
  it("is a row in Filling and Getting ready, counting the open orders", () => {
    expect(openOrdersFix(2, "filling")).toEqual({ count: 2 });
    expect(openOrdersFix(1, "ready")).toEqual({ count: 1 });
  });

  it("says nothing with no open order", () => {
    expect(openOrdersFix(0, "filling")).toBeNull();
    expect(openOrdersFix(0, "ready")).toBeNull();
  });

  it("is not a row at Check-in or once the list is only a record", () => {
    expect(openOrdersFix(3, "checkin")).toBeNull();
    expect(openOrdersFix(3, "listed")).toBeNull();
  });
});
