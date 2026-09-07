import { describe, expect, it } from "vitest";
import { CAPABILITY_ROUTE_PREFIXES } from "../../src/lib/capability-urls";
import { redactCapabilityText } from "./redact";

/**
 * The single control between a bearer token and a public issue, so it is tested
 * where the app's own redactor is tested rather than left as an untested regex
 * on a path no gate executes. Every case here is a shape that reached
 * `record()` in a real walk or could: a Playwright timeout quoting the URL it
 * did get, a console line naming the resource that failed, a refused request.
 */
describe("redactCapabilityText", () => {
  it("takes the token out of every capability route, wherever it sits in a sentence", () => {
    for (const prefix of CAPABILITY_ROUTE_PREFIXES) {
      const evidence = `page.goto: navigating to /${prefix}/s3cr3t-t0ken-value failed`;
      const redacted = redactCapabilityText(evidence);
      expect(redacted, prefix).toContain(`/${prefix}/[token]`);
      expect(redacted, prefix).not.toContain("s3cr3t-t0ken-value");
    }
  });

  it("takes it out of an absolute URL too, which is the shape a console line carries", () => {
    const redacted = redactCapabilityText(
      "Failed to load resource: http://127.0.0.1:27678/recap/abc123def456 answered 500",
    );
    expect(redacted).not.toContain("abc123def456");
    expect(redacted).toContain("/recap/[token]");
  });

  /**
   * The case that motivated delegating to `redactCapabilityUrl` instead of
   * matching prefixes locally: a percent-encoded first character defeats a
   * literal prefix match and does not defeat the app's decoder.
   */
  it("is not defeated by a percent-encoded prefix", () => {
    const redacted = redactCapabilityText("expected /%72eset-password/tok3n-here to load");
    expect(redacted).not.toContain("tok3n-here");
  });

  /**
   * The other half a local prefix regex missed entirely. `bookAndSign` waits on
   * `toHaveURL(/\/ready\//)`, and Playwright's timeout message quotes the URL it
   * did get — which on the embed path carries `?booking=`.
   */
  it("takes out a capability that travels as a query parameter", () => {
    for (const param of ["booking", "handoff", "gate"]) {
      const evidence = `Received string: "/s/blue-mantis/trips/abc?${param}=c4pab1l1ty-value"`;
      const redacted = redactCapabilityText(evidence);
      expect(redacted, param).not.toContain("c4pab1l1ty-value");
      expect(redacted, param).toContain(`${param}=%5Btoken%5D`);
    }
  });

  it("leaves ordinary evidence exactly as it was", () => {
    const evidence = 'a "Discover Scuba Diving" is 147x18\ncolor-contrast (serious) on .price';
    expect(redactCapabilityText(evidence)).toBe(evidence);
  });

  it("leaves a path that is not a capability alone, so the evidence stays readable", () => {
    const evidence = "GET /s/blue-mantis/courses answered 500";
    expect(redactCapabilityText(evidence)).toBe(evidence);
  });

  it("keeps prose that merely starts with a slash rather than blanking it", () => {
    expect(redactCapabilityText("the ratio is 1/2 and the box is 18px")).toBe(
      "the ratio is 1/2 and the box is 18px",
    );
  });
});
