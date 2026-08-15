// biome-ignore-all lint/suspicious/noTemplateCurlyInString: every string here is a
// source-code fixture, and the `${…}` in it is the interpolation the rule under test
// must decline to read a literal code out of. Making them real template literals would
// substitute the very thing being asserted about.

import { describe, expect, it } from "vitest";

import { findNoticeCodes, findNoticeCodeViolations } from "./check-notice-codes.mjs";

/**
 * The rule is only worth having if it sees all three shapes a notice code is
 * written in and none of the several near-misses that share their spelling.
 * Both halves have already been wrong once: the `noticeUrl(…)` scan shipped as
 * dead code (it tested `regex.matchAll`, which is not a method, so the branch
 * evaluated to `[]` and the shape was never checked at all), and the raw
 * `notice=` scan first flagged JSX props and prose placeholders.
 */

const codes = (source) => findNoticeCodes(source).map((found) => found.code);
const refused = (source) => findNoticeCodeViolations(source).map((found) => found.code);

describe("the raw query string", () => {
  it("reads a code written out in a template literal", () => {
    expect(codes("redirect(`${back}?notice=not-ready&bid=1`)")).toEqual(["not-ready"]);
  });

  it("refuses snake_case", () => {
    expect(refused("redirect(`${back}?notice=not_ready`)")).toEqual(["not_ready"]);
    expect(refused("redirect(`${settings}?notice=rental_prices_saved&saved=x`)")).toEqual([
      "rental_prices_saved",
    ]);
  });

  it("refuses a code that shouts", () => {
    expect(refused("?notice=NotAuthorized")).toEqual(["NotAuthorized"]);
  });

  it("skips an interpolated value — `noticeCode` normalises those at the one door", () => {
    expect(codes("redirect(`${back}?notice=${outcome.reason}`)")).toEqual([]);
    expect(codes("`${back}?notice=${saved ? 'a' : 'b'}`")).toEqual([]);
  });

  it("skips the prose and JSX that share the spelling", () => {
    // Each of these is real text from the tree.
    expect(codes("<NoticeBanner notice={pageNotice} />")).toEqual([]);
    expect(codes(" * redirecting back with `?notice=<code>&saved=<section>`")).toEqual([]);
    expect(codes(" * so `?notice=shown|hidden` is enough").slice(0, 1)).toEqual(["shown"]);
    expect(codes('"never walks the prototype for ?notice=%s"')).toEqual([]);
    expect(codes(" * The `?notice=` -> banner plumbing every page repeats")).toEqual([]);
  });
});

describe("the noticeUrl argument", () => {
  it("reads the code past a nested call in the first argument", () => {
    expect(codes('redirect(noticeUrl(shopPath(slug, "orders"), "not-authorized"))')).toEqual([
      "not-authorized",
    ]);
  });

  it("refuses snake_case there too — the shape everything migrated onto", () => {
    expect(
      refused('redirect(noticeUrl(settings, "packing_invalid", { saved: "packing" }))'),
    ).toEqual(["packing_invalid"]);
  });

  it("reads past a template literal first argument carrying its own comma-free query", () => {
    expect(
      codes('revalidateAndRedirect(back, noticeUrl(`${back}${anchor}`, "last-minute-sent"))'),
    ).toEqual(["last-minute-sent"]);
  });

  it("skips a computed code, which is a runtime value like any other", () => {
    expect(codes("revalidateAndRedirect(path, noticeUrl(path, notice))")).toEqual([]);
    expect(codes('noticeUrl(back, saved ? "conditions" : "invalid")')).toEqual([]);
  });

  it("does not fall over on a call with only one argument", () => {
    expect(codes("noticeUrl(path)")).toEqual([]);
  });

  it("reports the line the call starts on", () => {
    const source = ["const a = 1;", "const b = 2;", 'redirect(noticeUrl(p, "bad_code"));'].join(
      "\n",
    );
    expect(findNoticeCodeViolations(source)).toEqual([
      { code: "bad_code", line: 3, shape: 'noticeUrl(…, "bad_code")' },
    ]);
  });
});

describe("the reader side", () => {
  /**
   * The regression that added this shape. The 2026-08-15 migration renamed the
   * key in the walk-in page's `NOTICE_KEYS` and left the comparison two lines
   * below it, so the counter's "which card is missing" sentence silently fell
   * back to the generic one. Nothing was red; a security review found it.
   */
  it("refuses a comparison left behind by a rename", () => {
    expect(refused('notice === "walkin_trip_prerequisite"')).toEqual(["walkin_trip_prerequisite"]);
  });

  it("reads the comparison whatever the variable is called", () => {
    expect(codes('const x = notice === "saved" ? 1 : 2;')).toEqual(["saved"]);
    expect(codes('query.notice !== "shift-deleted"')).toEqual(["shift-deleted"]);
    expect(codes('builderNotice === "series-error"')).toEqual(["series-error"]);
  });

  it("leaves comparisons that are not about a notice alone", () => {
    // Every one of these is a real enum comparison in the tree.
    expect(codes('outcome.reason === "not_ready"')).toEqual([]);
    expect(codes('diver.messageStatus === "no_email"')).toEqual([]);
    expect(codes('account?.status !== "active"')).toEqual([]);
  });
});

describe("the URL-object spelling", () => {
  it("reads a code set through searchParams", () => {
    expect(codes('settingsUrl.searchParams.set("notice", "not-authorized");')).toEqual([
      "not-authorized",
    ]);
  });

  it("refuses snake_case there — the Stripe Connect callbacks' own shape", () => {
    expect(refused(`url.searchParams.set('notice', 'not_authorized')`)).toEqual(["not_authorized"]);
  });

  it("ignores a different param set the same way", () => {
    expect(codes('url.searchParams.set("saved", "packing_list");')).toEqual([]);
  });
});
