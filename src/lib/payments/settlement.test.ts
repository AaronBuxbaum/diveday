import { describe, expect, it } from "vitest";
import { allocateSettledTotal, type SettlementShare } from "./settlement";

function sum(allocation: Map<string, number>): number {
  return [...allocation.values()].reduce((total, cents) => total + cents, 0);
}

describe("allocateSettledTotal", () => {
  it("gives each booking exactly what it was asked for when nothing was discounted", () => {
    const shares: SettlementShare[] = [
      { key: "a", askedCents: 18_000 },
      { key: "b", askedCents: 24_000 },
    ];
    const allocation = allocateSettledTotal(shares, 42_000);
    expect(allocation.get("a")).toBe(18_000);
    expect(allocation.get("b")).toBe(24_000);
  });

  it("splits a discounted total in proportion to what each was asked", () => {
    // 10% off a $180 + $240 party: each diver bears their own share of it.
    const allocation = allocateSettledTotal(
      [
        { key: "a", askedCents: 18_000 },
        { key: "b", askedCents: 24_000 },
      ],
      37_800,
    );
    expect(allocation.get("a")).toBe(16_200);
    expect(allocation.get("b")).toBe(21_600);
    expect(sum(allocation)).toBe(37_800);
  });

  it("never leaves an orphan cent: the split sums to the settled total exactly", () => {
    // $100 across three equal shares is 3333.33… each — someone must get the
    // extra cent, and it must be the same someone every run.
    const shares: SettlementShare[] = [
      { key: "b", askedCents: 10_000 },
      { key: "c", askedCents: 10_000 },
      { key: "a", askedCents: 10_000 },
    ];
    const allocation = allocateSettledTotal(shares, 10_000);
    expect(sum(allocation)).toBe(10_000);
    expect([...allocation.values()].sort()).toEqual([3_333, 3_333, 3_334]);
    // Ties break on the key, ascending — deterministic across replays.
    expect(allocation.get("a")).toBe(3_334);
    expect(allocateSettledTotal([...shares].reverse(), 10_000).get("a")).toBe(3_334);
  });

  it("never rounds a share above what it was asked for", () => {
    const shares: SettlementShare[] = [
      { key: "a", askedCents: 1 },
      { key: "b", askedCents: 1 },
      { key: "c", askedCents: 10_000 },
    ];
    const allocation = allocateSettledTotal(shares, 9_999);
    expect(allocation.get("a")).toBeLessThanOrEqual(1);
    expect(allocation.get("b")).toBeLessThanOrEqual(1);
    expect(sum(allocation)).toBe(9_999);
  });

  it("weights gear into a diver's share", () => {
    // Two divers at $180; one also rented $60 of gear. A $48 discount is borne
    // in proportion to each diver's own bill, not split down the middle.
    const allocation = allocateSettledTotal(
      [
        { key: "gear", askedCents: 24_000 },
        { key: "plain", askedCents: 18_000 },
      ],
      37_200,
    );
    expect(allocation.get("gear")).toBe(21_257);
    expect(allocation.get("plain")).toBe(15_943);
    expect(sum(allocation)).toBe(37_200);
  });

  it("handles the degenerate cases without throwing or inventing money", () => {
    expect(allocateSettledTotal([], 5_000).size).toBe(0);
    // A fully comped party: nothing was asked, so an even split is all that's left.
    const comped = allocateSettledTotal(
      [
        { key: "a", askedCents: 0 },
        { key: "b", askedCents: 0 },
      ],
      101,
    );
    expect(sum(comped)).toBe(101);
    expect(comped.get("a")).toBe(51);
    // A zero settlement (a 100%-off code) records zero, not the list price.
    const free = allocateSettledTotal([{ key: "a", askedCents: 18_000 }], 0);
    expect(free.get("a")).toBe(0);
    // Nonsense inputs clamp rather than propagate.
    expect(allocateSettledTotal([{ key: "a", askedCents: -5 }], -100).get("a")).toBe(0);
  });
});
