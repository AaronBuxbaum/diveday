import { describe, expect, it } from "vitest";
import { renderRobotsTxt, robotsRules } from "./robots";

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
  "/unsubscribe/",
];

const ORIGIN = "https://dive.day";

describe("robots", () => {
  it("disallows every bearer-token route prefix", () => {
    expect(robotsRules(ORIGIN).disallow).toEqual(expect.arrayContaining(TOKEN_ROUTE_PREFIXES));
    const body = renderRobotsTxt(ORIGIN);
    for (const prefix of TOKEN_ROUTE_PREFIXES) expect(body).toContain(`Disallow: ${prefix}\n`);
  });

  it("still allows crawling generally and disallows the API", () => {
    const rules = robotsRules(ORIGIN);
    expect(rules.allow).toBe("/");
    expect(rules.disallow).toEqual(expect.arrayContaining(["/api/"]));
    expect(renderRobotsTxt(ORIGIN)).toMatch(/^User-Agent: \*\nAllow: \/\n/);
  });

  it("points the sitemap at the public origin", () => {
    expect(renderRobotsTxt(ORIGIN)).toMatch(/^Sitemap: https:\/\/dive\.day\/sitemap\.xml$/m);
  });

  it("tells an agent where llms.txt is, as a comment no crawler reads as a rule", () => {
    const body = renderRobotsTxt(ORIGIN);
    expect(body).toMatch(/^# Agents: https:\/\/dive\.day\/llms\.txt$/m);
    // Nothing after the sitemap line is a directive.
    expect(body.split("Sitemap:")[1]).not.toMatch(/^(Allow|Disallow|User-Agent):/m);
  });
});
