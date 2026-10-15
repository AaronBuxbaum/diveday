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
});
