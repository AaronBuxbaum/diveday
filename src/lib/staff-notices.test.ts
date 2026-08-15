import { describe, expect, it } from "vitest";
import {
  NOTICE_CODE_PATTERN,
  noticeCode,
  noticeFromParam,
  noticeRole,
  noticeUrl,
  shopPath,
} from "./staff-notices";

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

describe("shopPath", () => {
  it("builds a staff path from a slug and segments", () => {
    expect(shopPath("blue-mantis")).toBe("/shop/blue-mantis");
    expect(shopPath("blue-mantis", "trips", "abc", "manifest")).toBe(
      "/shop/blue-mantis/trips/abc/manifest",
    );
  });

  /**
   * The reason this encodes rather than joins. `shopSlug` arrives at a server
   * action as an ordinary argument, so a caller chooses it, and several actions
   * never compare it to the session; the `` `/shop/${shopSlug}/check-in` ``
   * template it replaces handed that caller the rest of the URL.
   *
   * Both assertions below are the *real* threat, and neither is an off-site
   * redirect — the literal `/shop/` prefix keeps the origin. Traversal escapes
   * the namespace; a `?` or `#` in a segment detaches the `?notice=` appended
   * after it, so the refusal renders nowhere at all.
   */
  it("keeps a hostile slug inside one path segment", () => {
    expect(shopPath("../../admin")).toBe("/shop/..%2F..%2Fadmin");
    expect(shopPath("a?b=c", "orders")).toBe("/shop/a%3Fb%3Dc/orders");
    expect(shopPath("a#b", "orders")).toBe("/shop/a%23b/orders");
    // Same origin either way, but the escaped form is a 404 (the layout's
    // cross-tenant `notFound()`) rather than a path nobody wrote.
    expect(shopPath("//host", "check-in")).toBe("/shop/%2F%2Fhost/check-in");
  });

  /**
   * The one that actually bites: unescaped, the query the refusal is appended
   * to belongs to the slug instead.
   */
  it("keeps the notice on the URL a hostile slug would otherwise have eaten", () => {
    expect(noticeUrl(shopPath("a?steal=1", "check-in"), "invalid")).toBe(
      "/shop/a%3Fsteal%3D1/check-in?notice=invalid",
    );
  });
});

describe("noticeCode", () => {
  it("normalises the casing a domain reason arrives in", () => {
    expect(noticeCode("medical_attestation_required")).toBe("medical-attestation-required");
    expect(noticeCode("not_authorized")).toBe("not-authorized");
    expect(noticeCode("NOT_FOUND")).toBe("not-found");
  });

  it("leaves an already-canonical code alone", () => {
    expect(noticeCode("last-minute-sent")).toBe("last-minute-sent");
  });

  it("agrees with the pattern the repo check enforces", () => {
    for (const reason of ["not_authorized", "trip_departed", "half_filled", "saved"]) {
      expect(noticeCode(reason)).toMatch(NOTICE_CODE_PATTERN);
    }
  });
});

describe("noticeUrl", () => {
  it("adds the notice to a query-less path", () => {
    expect(noticeUrl("/shop/blue-mantis/settings", "units-saved")).toBe(
      "/shop/blue-mantis/settings?notice=units-saved",
    );
  });

  it("normalises a snake_case runtime reason", () => {
    expect(noticeUrl("/shop/blue-mantis/check-in", "not_ready")).toBe(
      "/shop/blue-mantis/check-in?notice=not-ready",
    );
  });

  it("merges extra params rather than concatenating them", () => {
    expect(
      noticeUrl("/shop/blue-mantis/trips/t1", "capacity-below-booked", {
        count: 4,
        form: "details",
      }),
    ).toBe("/shop/blue-mantis/trips/t1?notice=capacity-below-booked&count=4&form=details");
  });

  it("drops an extra whose value is undefined instead of writing the word", () => {
    expect(noticeUrl("/x", "saved", { bid: undefined, tid: "t1" })).toBe("/x?notice=saved&tid=t1");
  });

  it("keeps a query the path already carries", () => {
    expect(noticeUrl("/shop/blue-mantis/divers?q=ana&page=2", "restored")).toBe(
      "/shop/blue-mantis/divers?q=ana&page=2&notice=restored",
    );
  });

  it("keeps the notice ahead of a fragment the refusal scrolls to", () => {
    expect(noticeUrl("/shop/blue-mantis/reviews#review-r1", "reason-required")).toBe(
      "/shop/blue-mantis/reviews?notice=reason-required#review-r1",
    );
    expect(noticeUrl("/shop/blue-mantis/reviews?page=2#review-r1", "note-required")).toBe(
      "/shop/blue-mantis/reviews?page=2&notice=note-required#review-r1",
    );
  });

  /**
   * The two sites this replaces (`check-in/actions.ts`, `staffing/actions.ts`)
   * interpolated a runtime value straight into the query. A value carrying `&`
   * or `#` there does not stay one parameter — it appends parameters of its
   * own, or truncates the URL at a fragment.
   */
  it("encodes a value that would otherwise write its own query params", () => {
    expect(noticeUrl("/x", "saved", { bid: "a&admin=1" })).toBe(
      "/x?notice=saved&bid=a%26admin%3D1",
    );
    expect(noticeUrl("/x", "saved", { note: "a#b" })).toBe("/x?notice=saved&note=a%23b");
    // A code is normalised, never trusted: one that would smuggle a second
    // `notice=` past the first comes back as a single unrecognised value, and
    // an unrecognised code is a code every destination map already renders
    // nothing for.
    expect(noticeUrl("/x", "we ird&notice=other")).toBe("/x?notice=we%20ird%26notice%3Dother");
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
