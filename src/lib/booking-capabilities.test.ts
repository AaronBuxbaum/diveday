import { describe, expect, it } from "vitest";
import {
  CAPABILITY_MAX_TTL_MS,
  CAPABILITY_MIN_TTL_MS,
  CAPABILITY_TRIP_GRACE_MS,
  capabilityExpiryFor,
  createCapabilityToken,
  hashCapabilityToken,
  readinessLinkPath,
} from "./booking-capabilities";

describe("capabilityExpiryFor", () => {
  it("uses tripEndsAt + grace when that lands within [min, max]", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const tripEndsAt = new Date("2026-07-30T00:00:00Z");
    const expiry = capabilityExpiryFor(tripEndsAt, now);
    expect(expiry.getTime()).toBe(tripEndsAt.getTime() + CAPABILITY_TRIP_GRACE_MS);
  });

  it("floors at now + min when tripEndsAt + grace falls just short of the floor", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    // One hour under the floor: tripBound (= trip end + grace) lands at
    // now + 23h, just below the 24h floor — distinct from the
    // already-way-in-the-past case below.
    const tripEndsAt = new Date(
      now.getTime() - CAPABILITY_TRIP_GRACE_MS + CAPABILITY_MIN_TTL_MS - 60 * 60 * 1000,
    );
    const expiry = capabilityExpiryFor(tripEndsAt, now);
    expect(expiry.getTime()).toBe(now.getTime() + CAPABILITY_MIN_TTL_MS);
  });

  it("uses tripEndsAt + grace for a trip ending imminently (well above the floor)", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const tripEndsAt = new Date("2026-07-24T01:00:00Z");
    const expiry = capabilityExpiryFor(tripEndsAt, now);
    expect(expiry.getTime()).toBe(tripEndsAt.getTime() + CAPABILITY_TRIP_GRACE_MS);
  });

  it("floors at now + min for a trip whose grace window is long gone", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const tripEndsAt = new Date("2026-01-01T00:00:00Z");
    const expiry = capabilityExpiryFor(tripEndsAt, now);
    expect(expiry.getTime()).toBe(now.getTime() + CAPABILITY_MIN_TTL_MS);
  });

  it("still covers the recap window for a trip that ended a fortnight ago", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const tripEndsAt = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const expiry = capabilityExpiryFor(tripEndsAt, now);
    expect(expiry.getTime()).toBe(tripEndsAt.getTime() + CAPABILITY_TRIP_GRACE_MS);
  });

  it("keeps a season-ahead booking's link alive on trip day and through the recap window", () => {
    // The bug this replaces: a flat 60-day TTL from issuance meant a trip
    // booked six months out had a dead confirmation URL — and a dead
    // readiness link in its own confirmation email — before the boat left.
    const now = new Date("2026-01-10T00:00:00Z");
    const tripStartsAt = new Date("2026-07-10T08:00:00Z");
    const tripEndsAt = new Date("2026-07-10T16:00:00Z");
    const expiry = capabilityExpiryFor(tripEndsAt, now);
    expect(expiry.getTime()).toBeGreaterThan(tripStartsAt.getTime());
    expect(expiry.getTime()).toBe(tripEndsAt.getTime() + CAPABILITY_TRIP_GRACE_MS);
  });

  it("caps at now + max for a nonsense departure date, so it is still bounded", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const tripEndsAt = new Date("2199-01-01T00:00:00Z");
    const expiry = capabilityExpiryFor(tripEndsAt, now);
    expect(expiry.getTime()).toBe(now.getTime() + CAPABILITY_MAX_TTL_MS);
  });

  it("is never unlimited: even the backstop is a real, enforced expiry", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const expiry = capabilityExpiryFor(new Date("9999-01-01T00:00:00Z"), now);
    expect(Number.isFinite(expiry.getTime())).toBe(true);
    expect(expiry.getTime()).toBeLessThanOrEqual(now.getTime() + CAPABILITY_MAX_TTL_MS);
  });

  it("never returns an expiry before now + min, even at the exact boundary", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const tripEndsAt = new Date(now.getTime() + CAPABILITY_MIN_TTL_MS - CAPABILITY_TRIP_GRACE_MS);
    const expiry = capabilityExpiryFor(tripEndsAt, now);
    expect(expiry.getTime()).toBe(now.getTime() + CAPABILITY_MIN_TTL_MS);
  });
});

describe("createCapabilityToken", () => {
  it("generates a non-empty, URL-safe, unpredictable token each call", () => {
    const a = createCapabilityToken();
    const b = createCapabilityToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("hashCapabilityToken", () => {
  it("is deterministic for the same input", () => {
    const token = "some-example-token";
    expect(hashCapabilityToken(token)).toBe(hashCapabilityToken(token));
  });

  it("differs for different inputs", () => {
    expect(hashCapabilityToken("token-a")).not.toBe(hashCapabilityToken("token-b"));
  });

  it("never stores the raw token as its own hash", () => {
    const token = "some-example-token";
    expect(hashCapabilityToken(token)).not.toBe(token);
  });
});

describe("readinessLinkPath", () => {
  it("builds the absolute readiness path for a token", () => {
    expect(readinessLinkPath("abc123")).toBe("/ready/abc123");
  });
});
