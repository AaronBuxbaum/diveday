import { describe, expect, it } from "vitest";
import { compareMonth } from "./rules";

const OFFER = { monthlyCents: 0, basisPoints: 200 };

const byName = (rows: ReturnType<typeof compareMonth>) =>
  Object.fromEntries(rows.map((row) => [row.system, row]));

describe("compareMonth", () => {
  it("counts a $60,000 card month the same way in both columns", () => {
    const rows = byName(compareMonth(6_000_000, 0, OFFER));
    const processing = 174_000 + 12_000; // 2.9% + 30c over 400 sales of $150
    expect(rows.fareharbor).toMatchObject({
      subscriptionCents: 0,
      bookingFeeCents: 360_000, // 6%
      otaFeeCents: 0,
      processingCents: processing,
      totalLowCents: 360_000 + processing,
      totalHighCents: 360_000 + processing,
    });
    expect(rows.diveday).toMatchObject({
      subscriptionCents: 0,
      bookingFeeCents: 120_000, // the offer's 2%
      otaFeeCents: 0,
      processingCents: processing,
      totalLowCents: 120_000 + processing,
    });
  });

  it("follows the configured offer, including a monthly subscription", () => {
    const rows = byName(compareMonth(6_000_000, 0, { monthlyCents: 4_900, basisPoints: 300 }));
    expect(rows.diveday?.subscriptionCents).toBe(4_900);
    expect(rows.diveday?.bookingFeeCents).toBe(180_000);
  });

  it("is zero for both in a month with no money", () => {
    const rows = byName(compareMonth(0, 0, OFFER));
    expect(rows.fareharbor?.totalHighCents).toBe(0);
    expect(rows.diveday?.totalHighCents).toBe(0);
  });

  it("gives the marketplace commission as a 15% to 30% range, the same in both columns", () => {
    const rows = byName(compareMonth(6_000_000, 0.5, OFFER));
    // $30,000 through the marketplaces.
    for (const row of Object.values(rows)) {
      expect(row.marketplaceLowCents).toBe(450_000);
      expect(row.marketplaceHighCents).toBe(900_000);
    }
    expect(rows.fareharbor?.totalHighCents).toBeGreaterThan(rows.fareharbor?.totalLowCents ?? 0);
  });

  it("charges FareHarbor a 2% OTA fee on marketplace money and DiveDay nothing, with card fees only on the rest", () => {
    const rows = byName(compareMonth(6_000_000, 0.5, OFFER));
    // 6% of $30,000 direct, 2% of $30,000 marketplace.
    expect(rows.fareharbor?.bookingFeeCents).toBe(180_000);
    expect(rows.fareharbor?.otaFeeCents).toBe(60_000);
    expect(rows.diveday?.bookingFeeCents).toBe(60_000);
    expect(rows.diveday?.otaFeeCents).toBe(0);
    expect(rows.diveday?.processingCents).toBe(87_000 + 6_000);
  });

  it("takes every percent off the full amount, never off what another fee leaves", () => {
    // $10,000 all direct: 6%, 2.9% and 2% are each of $10,000, not of a remainder.
    const rows = byName(compareMonth(1_000_000, 0, OFFER));
    expect(rows.fareharbor?.bookingFeeCents).toBe(60_000);
    expect(rows.diveday?.bookingFeeCents).toBe(20_000);
    expect(rows.diveday?.processingCents).toBe(29_000 + 67 * 30);
    // $10,000 all through marketplaces: commission and OTA fee are each of $10,000.
    const sold = byName(compareMonth(1_000_000, 1, OFFER));
    expect(sold.fareharbor?.otaFeeCents).toBe(20_000);
    expect(sold.fareharbor?.marketplaceLowCents).toBe(150_000);
    expect(sold.fareharbor?.marketplaceHighCents).toBe(300_000);
  });

  it("clamps a share outside 0 to 1 and a negative amount", () => {
    expect(compareMonth(-5, 3, OFFER).every((row) => row.totalHighCents >= 0)).toBe(true);
  });
});
