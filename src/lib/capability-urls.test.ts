import { describe, expect, it } from "vitest";
import { CAPABILITY_ROUTE_PREFIXES, redactCapabilityUrl } from "./capability-urls";

/**
 * The URL is the capability on these routes, so whatever reaches telemetry has
 * to be the route's shape, never the token. These cases are the ways a token
 * could slip past a naive prefix match.
 */
describe("redacting a capability URL", () => {
  it.each(CAPABILITY_ROUTE_PREFIXES)("keeps /%s/<token> to its shape", (prefix) => {
    expect(redactCapabilityUrl(`/${prefix}/s3cr3t-token`)).toBe(`/${prefix}/[token]`);
  });

  it("drops everything after the token, including a query that repeats it", () => {
    expect(redactCapabilityUrl("/waivers/abc123/forms?ref=abc123#sign")).toBe("/waivers/[token]");
  });

  it("matches the prefix however it is cased or percent-encoded", () => {
    expect(redactCapabilityUrl("/WAIVERS/abc123")).toBe("/waivers/[token]");
    expect(redactCapabilityUrl("/%77aivers/abc123")).toBe("/waivers/[token]");
  });

  it("redacts an absolute URL, and a protocol-relative one naming another host", () => {
    expect(redactCapabilityUrl("https://diveday.example/ready/abc123")).toBe("/ready/[token]");
    expect(redactCapabilityUrl("//evil.example/recap/abc123")).toBe("/recap/[token]");
  });

  it("leaves a capability prefix with no token after it alone", () => {
    expect(redactCapabilityUrl("/waivers")).toBe("/waivers");
  });

  it("does not treat a prefix deeper in the path as a capability route", () => {
    expect(redactCapabilityUrl("/shop/blue-mantis/waivers")).toBe("/shop/blue-mantis/waivers");
  });

  it("survives a malformed percent escape without throwing or leaking", () => {
    expect(redactCapabilityUrl("/%E0%A4%A/abc123")).toBe("/%E0%A4%A/abc123");
    expect(redactCapabilityUrl("/verify/%E0%A4%A")).toBe("/verify/[token]");
  });

  it("blanks every bearer query parameter and keeps the rest of the query", () => {
    const redacted = redactCapabilityUrl(
      "/s/blue-mantis/trips/t1?handoff=abc&booking=b1&preview=p&setup=s&key=k&gate=g&tab=crew",
    );
    const params = new URL(redacted, "https://x.invalid").searchParams;
    for (const name of ["handoff", "booking", "preview", "setup", "key", "gate"]) {
      expect(params.get(name)).toBe("[token]");
    }
    expect(params.get("tab")).toBe("crew");
    expect(redacted).not.toContain("abc");
  });

  it("returns an ordinary URL unchanged", () => {
    expect(redactCapabilityUrl("/s/blue-mantis?tab=schedule")).toBe("/s/blue-mantis?tab=schedule");
  });

  it("refuses to echo a URL it cannot parse", () => {
    expect(redactCapabilityUrl("http://[::1")).toBe("[unparseable]");
  });
});
