import { describe, expect, it } from "vitest";
import { compareMonth } from "./rules";

const OFFER = { monthlyCents: 0, basisPoints: 100 };

const byName = (rows: ReturnType<typeof compareMonth>) =>
  Object.fromEntries(rows.map((row) => [row.system, row]));

describe("compareMonth", () => {
  it("takes DiveDay's 1% and FareHarbor's 6% off the same full amount", () => {
    const rows = byName(compareMonth(3_000_000, OFFER));
    expect(rows.diveday?.bookingFeeCents).toBe(30_000); // 1% of $30,000
    expect(rows.fareharbor?.bookingFeeCents).toBe(180_000); // 6% of $30,000
    expect(rows.fareharbor?.otaFeeCents).toBe(22_200); // 2% on top, of the $11,100 through agencies
    expect(rows.diveday?.otaFeeCents).toBe(0);
  });

  it("counts the same card processing in both columns", () => {
    const rows = byName(compareMonth(6_000_000, OFFER));
    const processing = 174_000 + 400 * 30; // 2.9% + 30c over 400 sales of $150
    expect(rows.fareharbor).toMatchObject({
      subscriptionCents: 0,
      bookingFeeCents: 360_000,
      otaFeeCents: 44_400,
      processingCents: processing,
      totalCents: 360_000 + 44_400 + processing,
    });
    expect(rows.diveday).toMatchObject({
      subscriptionCents: 0,
      bookingFeeCents: 60_000,
      otaFeeCents: 0,
      processingCents: processing,
      totalCents: 60_000 + processing,
    });
  });

  it("follows the configured offer, including a monthly subscription", () => {
    const rows = byName(compareMonth(6_000_000, { monthlyCents: 4_900, basisPoints: 300 }));
    expect(rows.diveday?.subscriptionCents).toBe(4_900);
    expect(rows.diveday?.bookingFeeCents).toBe(180_000);
  });

  it("is zero for both in a month with no money, and for a negative amount", () => {
    for (const received of [0, -5]) {
      const rows = byName(compareMonth(received, OFFER));
      expect(rows.fareharbor?.totalCents).toBe(0);
      expect(rows.diveday?.totalCents).toBe(0);
    }
  });
});
