import { describe, expect, it } from "vitest";
import { compareMonth, directSavingBasisPoints } from "./rules";

const OFFER = { monthlyCents: 0, basisPoints: 200 };

const byName = (rows: ReturnType<typeof compareMonth>) =>
  Object.fromEntries(rows.map((row) => [row.system, row]));

describe("compareMonth", () => {
  it("counts a $60,000 card month the same way in both columns", () => {
    const rows = byName(compareMonth(6_000_000, 0, OFFER));
    // 6% of $60,000, processing included.
    expect(rows.fareharbor?.totalCents).toBe(360_000);
    // The offer's 2% of $60,000, then 2.9% + 30c over 400 sales of $150.
    expect(rows.diveday?.softwareCents).toBe(120_000);
    expect(rows.diveday?.processingCents).toBe(174_000 + 12_000);
    expect(rows.diveday?.totalCents).toBe(306_000);
  });

  it("follows the configured offer, not a number of its own", () => {
    const rows = byName(compareMonth(6_000_000, 0, { monthlyCents: 0, basisPoints: 300 }));
    expect(rows.diveday?.softwareCents).toBe(180_000);
  });

  it("is zero for both in a month with no money", () => {
    const rows = byName(compareMonth(0, 0, OFFER));
    expect(rows.fareharbor?.totalCents).toBe(0);
    expect(rows.diveday?.totalCents).toBe(0);
  });

  it("charges Booking.com's commission the same in every column and no processing on that share", () => {
    const rows = byName(compareMonth(6_000_000, 0.5, OFFER));
    // 15% of $30,000.
    for (const row of Object.values(rows)) expect(row.bookingComCents).toBe(450_000);
    // Card processing is only on the other $30,000: 200 sales.
    expect(rows.diveday?.processingCents).toBe(87_000 + 6_000);
  });

  it("clamps a share outside 0 to 1 and a negative amount", () => {
    expect(compareMonth(-5, 3, OFFER).every((row) => row.totalCents >= 0)).toBe(true);
  });

  it("adds a flat monthly fee for a flat offer", () => {
    const rows = byName(compareMonth(1_000_000, 0, { monthlyCents: 9_900, basisPoints: 0 }));
    expect(rows.diveday?.softwareCents).toBe(9_900);
  });
});

describe("directSavingBasisPoints", () => {
  it("is Booking.com's 15% less DiveDay's 2% and a card sale's 2.9% + 30c", () => {
    // 2% + 2.9% + 0.2% = 5.1% of a $150 sale; 15% - 5.1% = 9.9%.
    expect(directSavingBasisPoints(OFFER)).toBe(990);
  });
});
