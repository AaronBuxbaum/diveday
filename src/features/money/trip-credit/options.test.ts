import { describe, expect, it } from "vitest";
import { plainSeatCreditFare } from "./options";

/**
 * ADR 20261125-diver-sign-in: the booking form offers "Use my trip credit"
 * only on a plain scheduled seat still to come, at a shop that adds nothing on
 * top, and quotes the seat's whole fare, deposit and balance together.
 */
const NOW = new Date("2026-11-25T12:00:00Z");
const trip = {
  priceCents: 10_000,
  depositCents: null,
  courseId: null,
  isPrivate: false,
  isRehearsal: false,
  status: "scheduled",
  startsAt: new Date("2026-11-28T12:00:00Z"),
};
const shop = { taxEnabled: false, passThroughFee: null };

describe("plainSeatCreditFare", () => {
  it("quotes a plain seat's whole fare", () => {
    expect(plainSeatCreditFare(trip, shop, NOW)).toBe(10_000);
  });

  it("adds the balance to a deposit, so credit covers the whole seat", () => {
    expect(plainSeatCreditFare({ ...trip, depositCents: 2_000 }, shop, NOW)).toBe(10_000);
  });

  it("quotes even the smallest fare", () => {
    expect(plainSeatCreditFare({ ...trip, priceCents: 1 }, shop, NOW)).toBe(1);
  });

  it.each([
    ["a course session", { courseId: "course-1" }],
    ["a private charter", { isPrivate: true }],
    ["a rehearsal", { isRehearsal: true }],
    ["a cancelled departure", { status: "cancelled" }],
    ["a departure leaving now", { startsAt: NOW }],
    ["a departure already gone", { startsAt: new Date("2026-11-24T12:00:00Z") }],
    ["a seat with no price", { priceCents: null }],
    ["a free seat", { priceCents: 0 }],
  ])("offers nothing on %s", (_name, change) => {
    expect(plainSeatCreditFare({ ...trip, ...change }, shop, NOW)).toBeNull();
  });

  it.each([
    ["tax", { taxEnabled: true }],
    ["a pass-through fee", { passThroughFee: { percentBps: 300 } }],
  ])("offers nothing at a shop that adds %s", (_name, change) => {
    expect(plainSeatCreditFare(trip, { ...shop, ...change }, NOW)).toBeNull();
  });

  it("reads the clock when no time is given", () => {
    expect(plainSeatCreditFare({ ...trip, startsAt: new Date(0) }, shop)).toBeNull();
  });
});
