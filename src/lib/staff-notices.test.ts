import { describe, expect, it } from "vitest";
import { noticeFromParam, noticeRole } from "./staff-notices";

/**
 * `?notice=` is attacker-supplied. Every page that renders a banner from it
 * keeps its own `Record<code, definition>` map, and the unsafe version of that
 * lookup — `notices[notice]` — resolves off `Object.prototype` for a handful
 * of ordinary-looking words. `constructor` is the sharp one: it returns a
 * *function*, which a page then hands to React as a child.
 */
const NOTICES = {
  saved: { tone: "success", text: "Saved." },
  invalid: { tone: "danger", text: "That didn't work." },
} as const;

describe("noticeFromParam", () => {
  it("returns the definition for a code the map holds", () => {
    expect(noticeFromParam("saved", NOTICES)).toEqual({ tone: "success", text: "Saved." });
  });

  it("returns undefined for an absent param", () => {
    expect(noticeFromParam(undefined, NOTICES)).toBeUndefined();
  });

  it("returns undefined for a code the map does not hold", () => {
    expect(noticeFromParam("nonsense", NOTICES)).toBeUndefined();
  });

  // The regression this helper exists for. Each of these resolves to something
  // truthy through a bare `map[code]`, and several are functions.
  it.each(["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf"])(
    "never walks the prototype for ?notice=%s",
    (hostile) => {
      expect(noticeFromParam(hostile, NOTICES)).toBeUndefined();
      // Spelled out because the point is not just "falsy" — it's that nothing
      // renderable ever comes back for a code the page did not define.
      expect(typeof noticeFromParam(hostile, NOTICES)).toBe("undefined");
    },
  );

  it("still resolves a legitimate code on a map built from a null prototype", () => {
    const bare: Record<string, string> = Object.assign(Object.create(null), { saved: "Saved." });
    expect(noticeFromParam("saved", bare)).toBe("Saved.");
    expect(noticeFromParam("constructor", bare)).toBeUndefined();
  });
});

describe("noticeRole", () => {
  it("makes a refusal an alert and everything else a status", () => {
    expect(noticeRole("danger")).toBe("alert");
    expect(noticeRole("success")).toBe("status");
    expect(noticeRole("warning")).toBe("status");
    expect(noticeRole("neutral")).toBe("status");
  });
});
