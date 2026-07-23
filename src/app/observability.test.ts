import { describe, expect, it } from "vitest";
import { redactCapabilityUrl } from "./observability";

describe("redactCapabilityUrl", () => {
  it("redacts a waiver token path", () => {
    expect(redactCapabilityUrl("/waivers/abc123.def456")).toBe("/waivers/[token]");
  });

  it("redacts a readiness token path", () => {
    expect(redactCapabilityUrl("/ready/abc123.def456")).toBe("/ready/[token]");
  });

  it("redacts a recap token path", () => {
    expect(redactCapabilityUrl("/recap/abc123.def456")).toBe("/recap/[token]");
  });

  it("redacts even with query string and hash", () => {
    expect(redactCapabilityUrl("/ready/abc123.def456?photo=error#section")).toBe("/ready/[token]");
  });

  it("redacts a URL-encoded token-shaped path", () => {
    expect(redactCapabilityUrl("/waivers/abc%2Ecd%2E123")).toBe("/waivers/[token]");
  });

  it("redacts a URL-encoded route prefix", () => {
    expect(redactCapabilityUrl("/%77aivers/abc123.def456")).toBe("/waivers/[token]");
  });

  it("redacts regardless of prefix casing", () => {
    expect(redactCapabilityUrl("/Waivers/abc123.def456")).toBe("/waivers/[token]");
    expect(redactCapabilityUrl("/READY/abc123.def456")).toBe("/ready/[token]");
  });

  it("redacts an absolute URL with a capability path", () => {
    expect(redactCapabilityUrl("https://diveday.example/recap/abc123.def456")).toBe(
      "/recap/[token]",
    );
  });

  it("leaves ordinary public pages unchanged", () => {
    expect(redactCapabilityUrl("/shop/blue-hole/schedule")).toBe("/shop/blue-hole/schedule");
  });

  it("leaves ordinary staff pages unchanged", () => {
    expect(redactCapabilityUrl("/shop/blue-hole/trips/today?filter=open")).toBe(
      "/shop/blue-hole/trips/today?filter=open",
    );
  });

  it("leaves the root path unchanged", () => {
    expect(redactCapabilityUrl("/")).toBe("/");
  });

  it("does not treat a prefix-only path as a leak but still passes it through untouched", () => {
    // No token segment present; nothing to redact, and nothing sensitive to hide.
    expect(redactCapabilityUrl("/ready")).toBe("/ready");
  });

  it("does not choke on a malformed percent-encoding", () => {
    expect(() => redactCapabilityUrl("/waivers/%E0%A4%A")).not.toThrow();
  });
});
