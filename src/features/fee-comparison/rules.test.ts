import { describe, expect, it } from "vitest";
import { compareMonth } from "./rules";

const OFFER = { monthlyCents: 0, basisPoints: 100 };

const byName = (rows: ReturnType<typeof compareMonth>) =>
  Object.fromEntries(rows.map((row) => [row.system, row]));

describe("compareMonth", () => {
  it("counts a $60,000 month the same way in both columns, 37% of it through online travel agencies", () => {
    const rows = byName(compareMonth(6_000_000, OFFER));
    // $22,200 through the agencies, $37,800 taken directly.
    const processing = 109_620 + 7_560; // 2.9% + 30c over 252 sales of $150
    expect(rows.fareharbor).toMatchObject({
      subscriptionCents: 0,
      bookingFeeCents: 226_800, // 6% of the direct money
      otaFeeCents: 44_400, // 2% of the agency money
      processingCents: processing,
      totalCents: 226_800 + 44_400 + processing,
    });
    expect(rows.diveday).toMatchObject({
      subscriptionCents: 0,
      bookingFeeCents: 37_800, // the offer's 1% of the direct money
      otaFeeCents: 0,
      processingCents: processing,
      totalCents: 37_800 + processing,
    });
  });

  it("follows the configured offer, including a monthly subscription", () => {
    const rows = byName(compareMonth(6_000_000, { monthlyCents: 4_900, basisPoints: 300 }));
    expect(rows.diveday?.subscriptionCents).toBe(4_900);
    expect(rows.diveday?.bookingFeeCents).toBe(113_400);
  });

  it("is zero for both in a month with no money, and for a negative amount", () => {
    for (const received of [0, -5]) {
      const rows = byName(compareMonth(received, OFFER));
      expect(rows.fareharbor?.totalCents).toBe(0);
      expect(rows.diveday?.totalCents).toBe(0);
    }
  });

  it("takes every percent off the full amount, never off what another fee leaves", () => {
    // $10,000: $3,700 through the agencies, $6,300 direct.
    const rows = byName(compareMonth(1_000_000, OFFER));
    expect(rows.fareharbor?.bookingFeeCents).toBe(37_800);
    expect(rows.fareharbor?.otaFeeCents).toBe(7_400);
    expect(rows.diveday?.bookingFeeCents).toBe(6_300);
    expect(rows.diveday?.processingCents).toBe(18_270 + 42 * 30);
  });
});
