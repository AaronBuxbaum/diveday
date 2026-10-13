import { describe, expect, it } from "vitest";
import { publicTripPath } from "@/lib/public-routes";
import { readinessDoorPath } from "./readiness-door";

describe("readinessDoorPath", () => {
  it("is the departure's /ready door carrying the booking's token", () => {
    expect(readinessDoorPath("blue-mantis", "trip-1", "tok-123")).toBe(
      `${publicTripPath("blue-mantis", "trip-1")}/ready?booking=tok-123`,
    );
  });

  it("encodes a token that carries URL syntax", () => {
    expect(readinessDoorPath("blue-mantis", "trip-1", "a+b/c=&d")).toBe(
      `${publicTripPath("blue-mantis", "trip-1")}/ready?booking=a%2Bb%2Fc%3D%26d`,
    );
  });

  // The door was `/ready?booking=` with no token, which the route answered with a redirect back
  // to the departure: one round trip to arrive where the link could have gone (2026-10-13 review).
  it("goes straight to the departure's public page when there is no token", () => {
    expect(readinessDoorPath("blue-mantis", "trip-1", undefined)).toBe(
      publicTripPath("blue-mantis", "trip-1"),
    );
    expect(readinessDoorPath("blue-mantis", "trip-1", "")).toBe(
      publicTripPath("blue-mantis", "trip-1"),
    );
  });
});
