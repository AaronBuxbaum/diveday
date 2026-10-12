import { describe, expect, it } from "vitest";
import { isDemoSeatFor, signDemoSeat } from "./demo-seat";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("demo seat", () => {
  it("accepts a seat signed for the same shop", () => {
    expect(isDemoSeatFor(signDemoSeat(SHOP), SHOP)).toBe(true);
  });

  it("refuses a seat signed for another shop", () => {
    expect(isDemoSeatFor(signDemoSeat(OTHER), SHOP)).toBe(false);
  });

  it.each<[string | undefined, string]>([
    [undefined, "no cookie"],
    ["", "an empty cookie"],
    [SHOP, "the bare shop id"],
    ["é".repeat(43), "multibyte characters of the right length"],
    ["A".repeat(43), "a well-formed forgery"],
  ])("refuses %s (%s) without throwing", (value) => {
    expect(isDemoSeatFor(value, SHOP)).toBe(false);
  });
});
