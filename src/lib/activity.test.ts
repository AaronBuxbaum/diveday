import { describe, expect, it } from "vitest";
import {
  ACTIVITY_CODES,
  ACTIVITY_REDACTED,
  activityAudience,
  activityParams,
  catchUpKind,
  DESK_FLAGGED_CODES,
  DESK_ONLY_CODES,
  DIVER_AUDIENCE_CODES,
  deskCodesFeeding,
  isActivityCode,
  isDeskOnlyCode,
} from "./activity";
import { CATCH_UP_KINDS } from "./catch-up";

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

/**
 * **Desk lines are activity codes with a flag** (issue #2701): the catch-up
 * strip reads a line by its code, and the #1202 boundary holds by audience.
 */
describe("a desk line read back from the table", () => {
  it("names the catch-up line for a seat's new type", () => {
    const changed = (type: string) =>
      catchUpKind("participant_type_changed", { actor: "A", diver: "B", type });
    expect(changed("diver")).toBe("now_diving");
    expect(changed("snorkeler")).toBe("now_snorkeling");
    expect(changed("rider")).toBe("now_riding");
    expect(changed("submarine")).toBeNull();
  });

  it("feeds every catch-up sentence from at least one code", () => {
    const fed = new Set(
      DESK_FLAGGED_CODES.flatMap((code) =>
        ["diver", "snorkeler", "rider"].map((type) => catchUpKind(code, { type })),
      ),
    );
    for (const kind of CATCH_UP_KINDS) expect(fed).toContain(kind);
  });

  it("reads a trail line the desk does not flag as no desk line", () => {
    for (const code of ACTIVITY_CODES) {
      if (DESK_FLAGGED_CODES.includes(code)) continue;
      expect(catchUpKind(code, { actor: "A", diver: "B" })).toBeNull();
    }
    expect(catchUpKind(ACTIVITY_REDACTED.code, {})).toBeNull();
    expect(catchUpKind("desk_something_a_later_build_writes", {})).toBeNull();
  });

  it("does not repeat a seat moved away after the desk turned it away", () => {
    expect(catchUpKind("seat_moved_away", { actor: "A", diver: "B" })).toBe("seat_released");
    expect(catchUpKind("seat_moved_away", { actor: "A", diver: "B", turnedAway: "yes" })).toBe(
      null,
    );
  });

  it("keeps desk-only codes out of the trail's own vocabulary", () => {
    // A desk-only line that leaked into a trail would render the unknown-code
    // sentence, never a sentence about a diver.
    for (const code of DESK_ONLY_CODES) {
      expect(isDeskOnlyCode(code)).toBe(true);
      expect(isActivityCode(code)).toBe(false);
    }
    for (const code of ACTIVITY_CODES) expect(isDeskOnlyCode(code)).toBe(false);
  });

  it("names the codes behind each roster-checked kind, and only those", () => {
    expect(deskCodesFeeding("arrival")).toEqual(["counter_check_in"]);
    expect(deskCodesFeeding("running_late")).toEqual(["desk_running_late"]);
    expect(deskCodesFeeding("help_request")).toEqual(["desk_help_request"]);
    expect(deskCodesFeeding("seat_taken").sort()).toEqual(
      ["rider_added_at_dock", "seat_added", "seat_added_walk_in", "seat_moved_here"].sort(),
    );
  });
});

describe("who may read a line", () => {
  it("addresses every desk line and every trail line to staff", () => {
    for (const code of [...DESK_FLAGGED_CODES, ...ACTIVITY_CODES]) {
      expect(activityAudience(code)).toBe("staff");
    }
  });

  it("has no diver-audience code yet, so no diver reader has anything to read", () => {
    expect(DIVER_AUDIENCE_CODES).toEqual([]);
  });
});
