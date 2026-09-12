import { describe, expect, it } from "vitest";
import {
  NOTICE_CODE_PATTERN,
  type NoticeCodeOf,
  noticeCode,
  noticeFromParam,
  noticeRole,
  noticeUrl,
  safeShopReturnPath,
  shopPath,
  type WidenedNoticeReason,
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
  invalid: { tone: "danger", text: "That didn’t work." },
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

/**
 * The mirror of `shopPath`, and the one `divers/new` was missing: it read
 * `?returnTo=` off the query with nothing but a `trim()`, rendered it as the
 * back link's href, and after a successful create passed it to
 * `revalidateAndRedirect` as both the `revalidatePath` key and the redirect
 * target. A staffer who followed a crafted link was therefore bounced
 * off-origin the instant an authenticated write succeeded.
 */
describe("safeShopReturnPath", () => {
  it("keeps a path inside this shop, query and fragment intact", () => {
    expect(safeShopReturnPath("blue-mantis", "/shop/blue-mantis/divers?q=priya#row")).toBe(
      "/shop/blue-mantis/divers?q=priya#row",
    );
  });

  it("answers null for an absent, blank or whitespace-only value", () => {
    expect(safeShopReturnPath("blue-mantis", undefined)).toBeNull();
    expect(safeShopReturnPath("blue-mantis", null)).toBeNull();
    expect(safeShopReturnPath("blue-mantis", "")).toBeNull();
    expect(safeShopReturnPath("blue-mantis", "   ")).toBeNull();
  });

  // The finding itself: an absolute URL, and the protocol-relative spelling a
  // prefix test written against `http` alone lets through.
  it("refuses another origin", () => {
    expect(safeShopReturnPath("blue-mantis", "https://evil.invalid/steal")).toBeNull();
    expect(safeShopReturnPath("blue-mantis", "//evil.invalid/steal")).toBeNull();
    expect(safeShopReturnPath("blue-mantis", "http://evil.invalid/steal")).toBeNull();
    expect(safeShopReturnPath("blue-mantis", "javascript:alert(1)")).toBeNull();
    expect(safeShopReturnPath("blue-mantis", "  https://evil.invalid/steal  ")).toBeNull();
  });

  // Same origin, wrong tenant — the hop `requireShopSurface` would 404, but
  // only after the staffer has been sent there.
  it("refuses another shop, and a slug this one is merely a prefix of", () => {
    expect(safeShopReturnPath("blue-mantis", "/shop/reef-co/divers")).toBeNull();
    expect(safeShopReturnPath("blue-mantis", "/shop/blue-mantis-evil/divers")).toBeNull();
    expect(safeShopReturnPath("blue-mantis", "/admin")).toBeNull();
  });

  /**
   * The one a `startsWith` alone misses: this passes the prefix test and then
   * normalises to `/evil` in the browser, which is also the string
   * `revalidatePath` would have been keyed on.
   */
  it("refuses traversal that only escapes the shop once normalised", () => {
    expect(safeShopReturnPath("blue-mantis", "/shop/blue-mantis/../../evil")).toBeNull();
    expect(safeShopReturnPath("blue-mantis", "/shop/blue-mantis/trips/../../../evil")).toBeNull();
  });

  /**
   * ...and the percent-encoded spelling of the same thing is *not* traversal
   * and is not refused: neither `URL` nor a browser decodes `%2F` in a
   * pathname, so it stays one literal segment inside the shop and 404s there.
   * Asserted so the next reader does not "harden" this into a refusal and
   * quietly break a legitimate return path carrying an encoded id.
   */
  it("keeps a percent-encoded slash, which never leaves the segment", () => {
    expect(safeShopReturnPath("blue-mantis", "/shop/blue-mantis/..%2F..%2Fevil")).toBe(
      "/shop/blue-mantis/..%2F..%2Fevil",
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

  /**
   * `NoticeCodeOf` is the same normalisation at the type level, and the whole
   * point of it is that a page can type its notice map `Record<NoticeCodeOf<
   * Reason>, …>` and get a compile error instead of a silent blank banner. It is
   * only worth that if the two agree exactly — a type that kebabs differently
   * from the function would demand map keys no URL ever carries, which is the
   * same silent banner with extra steps.
   *
   * Asserted by assigning the function's output to the type: `tsc` refuses the
   * line if they diverge, and the runtime `expect` keeps the case honest if the
   * annotation is ever loosened to `string`.
   */
  it("matches NoticeCodeOf, the type-level spelling of the same rule", () => {
    const single: NoticeCodeOf<"saved"> = noticeCode("saved") as NoticeCodeOf<"saved">;
    const many: NoticeCodeOf<"already_checked_in"> = noticeCode(
      "already_checked_in",
    ) as NoticeCodeOf<"already_checked_in">;
    const shouted: NoticeCodeOf<"NOT_FOUND"> = noticeCode("NOT_FOUND") as NoticeCodeOf<"NOT_FOUND">;
    expect([single, many, shouted]).toEqual(["saved", "already-checked-in", "not-found"]);
  });

  /**
   * The failure mode that would make every map typed on it decorative: given the
   * wide `string`, a kebab type answers `string`, `Record<string, …>` demands no
   * key at all, and nothing goes red. The trigger is an edit that reads like a
   * loosening — a `reason` widened to `string`, or a `(string & {})` member added
   * for autocomplete — not like switching a check off.
   *
   * `never` is *not* the answer, which is worth pinning: `Record<never, …>` is
   * the empty object type and every map satisfies it, so the first version of
   * this guard let the widening through in silence. The sentinel key does not —
   * no map holds it, so the widening fails to compile at the map that lost its
   * guarantee. Asserted at the type level; `tsc` refuses these annotations if it
   * ever degrades again.
   */
  it("demands an impossible key, not never, when a reason union is widened", () => {
    type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const widened: Equals<NoticeCodeOf<string>, WidenedNoticeReason> = true;
    const notNever: Equals<NoticeCodeOf<string>, never> = false;
    const narrow: Equals<NoticeCodeOf<"not_found">, "not-found"> = true;
    expect([widened, notNever, narrow]).toEqual([true, false, true]);
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
