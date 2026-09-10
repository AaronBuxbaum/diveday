import { describe, expect, it } from "vitest";
import {
  BUDDY_PARAM,
  buddyReferralFromCookie,
  buddyReferralFromSearchParams,
  encodeBuddyCookie,
  isBuddyReferralIdShape,
} from "./buddy-links";
import { bookingIdFromBuddyReferral, buddyReferralId } from "./buddy-tokens";

/**
 * **The buddy seat's id** (ADR 20260908-one-hand, decision 6, lever W).
 *
 * Non-secret and it must stay that way — it is printed in a recap and pasted
 * into a group chat. What it has to do is resolve to exactly one booking, and
 * what it must never do is resolve to a booking nobody linked from: an
 * unsigned id would let anyone hand back a UUID and be counted.
 *
 * Junk is **ignored**, never refused: a friend who mangles the link still books
 * a seat, credited to nobody.
 */
const BOOKING = "3f4a2b1c-8d9e-4f60-a1b2-c3d4e5f60718";
const OTHER_BOOKING = "9a8b7c6d-5e4f-4a3b-8c9d-0e1f2a3b4c5d";

describe("buddy referral ids", () => {
  it("round-trips a booking id", () => {
    expect(bookingIdFromBuddyReferral(buddyReferralId(BOOKING))).toBe(BOOKING);
    expect(bookingIdFromBuddyReferral(buddyReferralId(OTHER_BOOKING))).toBe(OTHER_BOOKING);
  });

  it("is stable, so the same recap always shows the same link", () => {
    expect(buddyReferralId(BOOKING)).toBe(buddyReferralId(BOOKING));
  });

  it("is short enough to live in a shared URL", () => {
    // 22 packed characters, a dot, a 16-character tag.
    expect(buddyReferralId(BOOKING)).toHaveLength(39);
    expect(isBuddyReferralIdShape(buddyReferralId(BOOKING))).toBe(true);
  });

  it("ignores a bare booking id", () => {
    // The whole reason the id is signed: without this, anyone holding a booking
    // uuid could have a seat credited to it.
    expect(bookingIdFromBuddyReferral(BOOKING)).toBeNull();
  });

  it("ignores an id whose tag belongs to another booking", () => {
    const mine = buddyReferralId(BOOKING);
    const theirs = buddyReferralId(OTHER_BOOKING);
    const forged = `${mine.split(".")[0]}.${theirs.split(".")[1]}`;
    expect(bookingIdFromBuddyReferral(forged)).toBeNull();
  });

  it("ignores junk, a truncated paste, and an over-long string", () => {
    expect(bookingIdFromBuddyReferral(null)).toBeNull();
    expect(bookingIdFromBuddyReferral("")).toBeNull();
    expect(bookingIdFromBuddyReferral("hello")).toBeNull();
    expect(bookingIdFromBuddyReferral(buddyReferralId(BOOKING).slice(0, 20))).toBeNull();
    expect(bookingIdFromBuddyReferral("a".repeat(5_000))).toBeNull();
  });
});

describe("the cookie the storefront visit leaves", () => {
  it("gives the id back for the shop that minted it", () => {
    const id = buddyReferralId(BOOKING);
    expect(buddyReferralFromCookie(encodeBuddyCookie("blue-mantis", id), "blue-mantis")).toBe(id);
  });

  /**
   * One cookie covers the whole `/s/` namespace, so a diver who opened shop
   * A's buddy link and then books at shop B must not hand shop B a number
   * about shop A — the same tenant argument `partnerFromReferralCookie` makes.
   */
  it("refuses a cookie minted on another shop's storefront", () => {
    const id = buddyReferralId(BOOKING);
    expect(buddyReferralFromCookie(encodeBuddyCookie("blue-mantis", id), "coral-sands")).toBeNull();
  });

  it("refuses a hand-set cookie with no shop in it", () => {
    expect(buddyReferralFromCookie(buddyReferralId(BOOKING), "blue-mantis")).toBeNull();
    expect(buddyReferralFromCookie("", "blue-mantis")).toBeNull();
  });
});

describe("the ?via= a visit arrives on", () => {
  it("reads a single value", () => {
    const id = buddyReferralId(BOOKING);
    const params = new URLSearchParams({ [BUDDY_PARAM]: id });
    expect(buddyReferralFromSearchParams(params)).toBe(id);
  });

  /**
   * `get()` silently returns the first of a repeated parameter, which would let
   * a crafted `?via=a&via=b` mean one thing at the edge and another to a reader
   * that looks at the array. Exactly one value, or none.
   */
  it("refuses a repeated parameter", () => {
    const params = new URLSearchParams();
    params.append(BUDDY_PARAM, buddyReferralId(BOOKING));
    params.append(BUDDY_PARAM, buddyReferralId(OTHER_BOOKING));
    expect(buddyReferralFromSearchParams(params)).toBeNull();
  });

  it("refuses a value that is not shaped like an id", () => {
    expect(buddyReferralFromSearchParams(new URLSearchParams({ via: "../../etc" }))).toBeNull();
    expect(buddyReferralFromSearchParams(new URLSearchParams())).toBeNull();
  });
});
