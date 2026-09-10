import { afterEach, describe, expect, it, vi } from "vitest";
import { signGiftToken, verifyGiftToken } from "./gift-links";
import { signRecapToken, verifyRecapToken } from "./recap-links";

/**
 * **The giver's link** (ADR 20260908-one-hand, decision 6, lever W).
 *
 * The three things this token has to be, each with its own failure to prove:
 * it resolves to its own booking and nobody else's; it is not interchangeable
 * with the recap link built the same way; and it stops working eventually.
 */
const BOOKING = "3f4a2b1c-8d9e-4f60-a1b2-c3d4e5f60718";
const OTHER_BOOKING = "9a8b7c6d-5e4f-4a3b-8c9d-0e1f2a3b4c5d";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gift links", () => {
  it("resolves to the booking it was minted for", () => {
    expect(verifyGiftToken(signGiftToken(BOOKING))).toBe(BOOKING);
    expect(verifyGiftToken(signGiftToken(OTHER_BOOKING))).toBe(OTHER_BOOKING);
  });

  it("refuses a token whose payload was edited", () => {
    const token = signGiftToken(BOOKING);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(`gift:${OTHER_BOOKING}:0`, "utf8").toString("base64url");
    expect(payload).toBeDefined();
    expect(verifyGiftToken(`${forged}.${signature}`)).toBeNull();
  });

  it("refuses a token whose signature was edited", () => {
    const token = signGiftToken(BOOKING);
    expect(verifyGiftToken(`${token}x`)).toBeNull();
    expect(verifyGiftToken(token.replace(/.$/, (last) => (last === "a" ? "b" : "a")))).toBeNull();
  });

  /**
   * **A signature that is not base64url is refused, never thrown at**
   * (security review of this slice, finding 3). `timingSafeEqual` compares
   * bytes and throws on unequal lengths, so a 43-*character* signature
   * carrying a multibyte character used to reach it and raise `RangeError` —
   * which on a bearer page is a 500 where "this link isn't available" belongs.
   */
  it("refuses a signature of the right length in the wrong alphabet", () => {
    const token = signGiftToken(BOOKING);
    const [payload] = token.split(".");
    // 43 characters, one of them multibyte: the old length check passed.
    const multibyte = `${"a".repeat(42)}é`;
    expect(multibyte).toHaveLength(43);
    expect(() => verifyGiftToken(`${payload}.${multibyte}`)).not.toThrow();
    expect(verifyGiftToken(`${payload}.${multibyte}`)).toBeNull();
    // And a padded/─ shaped one, for the same reason.
    expect(verifyGiftToken(`${payload}.${"=".repeat(43)}`)).toBeNull();
  });

  it("refuses junk, an empty string and a token with no separator", () => {
    expect(verifyGiftToken("")).toBeNull();
    expect(verifyGiftToken("not-a-token")).toBeNull();
    expect(verifyGiftToken(".onlyasignature")).toBeNull();
  });

  /**
   * **The purpose prefix, in both directions.** A giver's page shows four facts
   * about somebody else's day; a recap page shows that diver their own dive
   * log, their review form and their photo uploads. Neither link may open the
   * other, and the two are built from the same construction over the same
   * booking id, so this is the assertion that keeps them apart.
   */
  it("is not interchangeable with a recap link over the same booking", () => {
    expect(verifyRecapToken(signGiftToken(BOOKING))).toBeNull();
    expect(verifyGiftToken(signRecapToken(BOOKING))).toBeNull();
  });

  it("stops working once it is older than its lifetime", () => {
    // The clock is frozen at the harness boundary (`DIVEDAY_CLOCK`), and that
    // is what `nowMs()` reads — so moving time here means moving that, never
    // the system clock.
    vi.stubEnv("DIVEDAY_CLOCK", "2026-01-01T00:00:00.000Z");
    const token = signGiftToken(BOOKING);
    expect(verifyGiftToken(token)).toBe(BOOKING);
    // Inside the window it still works; past it, it does not.
    vi.stubEnv("DIVEDAY_CLOCK", "2026-06-01T00:00:00.000Z");
    expect(verifyGiftToken(token)).toBe(BOOKING);
    vi.stubEnv("DIVEDAY_CLOCK", "2027-01-01T00:00:00.000Z");
    expect(verifyGiftToken(token)).toBeNull();
  });

  it("refuses a well-signed token whose payload is not a booking id", () => {
    // Nothing mints this today; the check is what stops a future caller from
    // handing the page an arbitrary string it would then key a read on.
    const token = signGiftToken("not-a-uuid");
    expect(verifyGiftToken(token)).toBeNull();
  });
});
