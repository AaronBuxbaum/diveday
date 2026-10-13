import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import { DEMO_SEAT_MAX_AGE_SECONDS, isDemoSeatFor, signDemoSeat } from "./demo-seat";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.UTC(2031, 4, 10, 12);

describe("demo seat", () => {
  it("accepts a seat signed for the same shop", () => {
    expect(isDemoSeatFor(signDemoSeat(SHOP, NOW), SHOP, NOW)).toBe(true);
  });

  it("refuses a seat signed for another shop", () => {
    expect(isDemoSeatFor(signDemoSeat(OTHER, NOW), SHOP, NOW)).toBe(false);
  });

  it("is a different value for every visitor to the same shop", () => {
    expect(signDemoSeat(SHOP, NOW)).not.toBe(signDemoSeat(SHOP, NOW));
  });

  it("lasts a day, and is refused once it has run out", () => {
    expect(DEMO_SEAT_MAX_AGE_SECONDS).toBe(DAY_MS / 1000);
    const seat = signDemoSeat(SHOP, NOW);
    expect(isDemoSeatFor(seat, SHOP, NOW + DAY_MS - 1)).toBe(true);
    expect(isDemoSeatFor(seat, SHOP, NOW + DAY_MS)).toBe(false);
  });

  it("refuses a seat whose expiry was moved, or whose nonce was swapped", () => {
    const [nonce, expires, signature] = signDemoSeat(SHOP, NOW).split(".");
    const later = String(Number(expires) + 7 * DAY_MS);
    expect(isDemoSeatFor([nonce, later, signature].join("."), SHOP, NOW)).toBe(false);
    const [otherNonce] = signDemoSeat(SHOP, NOW).split(".");
    expect(isDemoSeatFor([otherNonce, expires, signature].join("."), SHOP, NOW)).toBe(false);
  });

  it.each<[string | undefined, string]>([
    [undefined, "no cookie"],
    ["", "an empty cookie"],
    [SHOP, "the bare shop id"],
    ["é".repeat(43), "multibyte characters of the right length"],
    ["A".repeat(43), "a well-formed forgery"],
    [`${"A".repeat(22)}.${NOW + DAY_MS}.${"A".repeat(43)}`, "a forged signature in the new shape"],
    [`${"A".repeat(22)}.soon.${"A".repeat(43)}`, "an expiry that is not a number"],
  ])("refuses %s (%s) without throwing", (value) => {
    expect(isDemoSeatFor(value, SHOP, NOW)).toBe(false);
  });
});
