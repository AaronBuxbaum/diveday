import { describe, expect, it } from "vitest";
import robots from "./robots";

/**
 * Every URL prefix that serves a bearer-token surface — the token in the URL
 * *is* the capability, so a crawler that reaches one of these must never be
 * allowed to fetch it. Keep this list in sync with the per-page
 * `robots: noindex` / `X-Robots-Tag` declarations on each route; a new
 * token surface that forgets to register here would otherwise be crawlable.
 */
const TOKEN_ROUTE_PREFIXES = [
  "/waivers/",
  "/ready/",
  "/recap/",
  "/offline-manifest",
  "/verify/",
  "/reset-password/",
  "/invite/",
  "/calendar/",
];

describe("robots", () => {
  it("disallows every bearer-token route prefix", () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow];
    expect(disallow).toEqual(expect.arrayContaining(TOKEN_ROUTE_PREFIXES));
  });

  it("still allows crawling generally and disallows the API", () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(expect.arrayContaining(["/api/"]));
  });

  it("points the sitemap at the public origin", () => {
    const { sitemap } = robots();
    expect(sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
