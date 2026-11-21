import { describe, expect, it } from "vitest";
import { signTodayCatchUp, verifyTodayCatchUp } from "./today-catch-up-token";

const scope = {
  shopId: "shop",
  personId: "staff",
  dayStart: "2026-10-27T04:00:00.000Z",
  mode: "ack" as const,
};

describe("Today catch-up snapshot", () => {
  it("only accepts the exact signed snapshot for the same staff, shop, day and operation", () => {
    const ids = ["00000000-0000-4000-8000-000000000001"];
    const token = signTodayCatchUp(scope, ids);
    expect(verifyTodayCatchUp(token, scope)).toEqual(ids);
    expect(verifyTodayCatchUp(token, { ...scope, personId: "other" })).toBeNull();
    expect(verifyTodayCatchUp(token, { ...scope, shopId: "other" })).toBeNull();
    expect(
      verifyTodayCatchUp(token, { ...scope, dayStart: "2026-10-28T04:00:00.000Z" }),
    ).toBeNull();
    expect(verifyTodayCatchUp(token, { ...scope, mode: "initialize" })).toBeNull();
    expect(verifyTodayCatchUp(`${token}x`, scope)).toBeNull();
    expect(verifyTodayCatchUp("invalid.é", scope)).toBeNull();
  });
});
