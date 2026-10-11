import { describe, expect, it } from "vitest";
import { ACTIVITY_CODES, ACTIVITY_REDACTED, activityParams, isActivityCode } from "./activity";

describe("an activity code read back from the table", () => {
  it("knows every code it declares, once", () => {
    expect(new Set(ACTIVITY_CODES).size).toBe(ACTIVITY_CODES.length);
    for (const code of ACTIVITY_CODES) expect(isActivityCode(code)).toBe(true);
  });

  it("does not know a code a newer build wrote, a near miss, or an inherited key", () => {
    for (const value of ["seat_added_by_robot", "Seat_Added", " seat_added", "", "toString"]) {
      expect(isActivityCode(value)).toBe(false);
    }
  });

  it("erases to a code it knows, with no names left", () => {
    expect(isActivityCode(ACTIVITY_REDACTED.code)).toBe(true);
    expect(activityParams(ACTIVITY_REDACTED.params)).toEqual({});
  });
});

describe("an activity line's names read back from jsonb", () => {
  it("keeps the string names", () => {
    expect(activityParams({ actor: "Dana", diver: "Rae" })).toEqual({
      actor: "Dana",
      diver: "Rae",
    });
  });

  it("drops every name that is not a string, rather than rendering it", () => {
    expect(
      activityParams({ actor: "Dana", diver: { fullName: "Rae" }, count: 3, gone: null }),
    ).toEqual({ actor: "Dana" });
  });

  it("answers anything that is not a plain object with no names", () => {
    for (const raw of [null, undefined, "Dana", 7, ["Dana"], true]) {
      expect(activityParams(raw)).toEqual({});
    }
  });

  it("does not let a stored __proto__ key reach the prototype", () => {
    const params = activityParams(
      JSON.parse('{"__proto__": {"polluted": "yes"}, "actor": "Dana"}'),
    );
    expect(params.actor).toBe("Dana");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
  });
});
