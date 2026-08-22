import { describe, expect, it } from "vitest";
import {
  entitlementExpiry,
  entitlementToSpend,
  MAX_PACKAGE_DIVE_COUNT,
  packageCoversTrip,
  type SpendableEntitlement,
  spendableCount,
  validateDivePackage,
} from "./dive-packages";

const NOW = new Date("2026-08-22T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

const entitlement = (over: Partial<SpendableEntitlement> = {}): SpendableEntitlement => ({
  id: "e1",
  packageId: "p1",
  scope: "all",
  expiresAt: null,
  consumedAt: null,
  ...over,
});

describe("defining a package", () => {
  const base = {
    name: "Ten dives",
    diveCount: 10,
    priceCents: 90_000,
    scope: "all" as const,
    validityDays: null,
  };

  it("accepts the ordinary product", () => {
    const result = validateDivePackage(base);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(result.value.name).toBe("Ten dives");
    expect(result.value.validityDays).toBeNull();
  });

  it("refuses a package nobody paid for", () => {
    // Zero is not a free package; it is an entitlement nobody paid for, which
    // is a seat the shop gave away by accident.
    const result = validateDivePackage({ ...base, priceCents: 0 });
    expect(result).toEqual({ ok: false, reason: "price_required" });
  });

  it("refuses a typo rather than clamping it", () => {
    // A shop that typed 1000 and got 100 has been quietly overruled about its
    // own product, and nothing on screen would say so.
    expect(validateDivePackage({ ...base, diveCount: MAX_PACKAGE_DIVE_COUNT + 1 })).toEqual({
      ok: false,
      reason: "dive_count_out_of_range",
    });
    expect(validateDivePackage({ ...base, diveCount: 0 })).toEqual({
      ok: false,
      reason: "dive_count_out_of_range",
    });
  });

  it("refuses a validity window of no days, and keeps null meaning never", () => {
    expect(validateDivePackage({ ...base, validityDays: 0 })).toEqual({
      ok: false,
      reason: "validity_out_of_range",
    });
    const forever = validateDivePackage({ ...base, validityDays: null });
    expect(forever.ok).toBe(true);
  });
});

describe("when a dive stops being usable", () => {
  it("is stamped from the purchase, not read back through the package", () => {
    // A later edit to the product must not retroactively shorten a package
    // somebody already bought — the exact shape of surprise this feature exists
    // to avoid.
    expect(entitlementExpiry(30, NOW)).toEqual(days(30));
    expect(entitlementExpiry(null, NOW)).toBeNull();
  });
});

describe("which dive gets spent", () => {
  it("spends the one that lapses soonest, not the one bought first", () => {
    // A diver holding a lapsing five-pack and an open-ended ten-pack should
    // have the lapsing one spent first, or the product quietly eats the dives
    // it was most likely to eat anyway.
    const chosen = entitlementToSpend(
      [
        entitlement({ id: "open-ended", expiresAt: null }),
        entitlement({ id: "lapses-soon", expiresAt: days(3) }),
        entitlement({ id: "lapses-later", expiresAt: days(30) }),
      ],
      { courseId: null },
      NOW,
    );
    expect(chosen?.id).toBe("lapses-soon");
  });

  it("falls back to an open-ended dive when nothing lapses", () => {
    const chosen = entitlementToSpend([entitlement({ id: "only" })], { courseId: null }, NOW);
    expect(chosen?.id).toBe("only");
  });

  it("will not spend a dive that has already lapsed", () => {
    // An expiry exactly now has passed: a dive good "until the 14th" is not
    // good on the 15th, and an inclusive boundary is how a diver arrives at the
    // dock believing otherwise.
    expect(
      entitlementToSpend([entitlement({ expiresAt: NOW })], { courseId: null }, NOW),
    ).toBeNull();
    expect(
      entitlementToSpend([entitlement({ expiresAt: days(-1) })], { courseId: null }, NOW),
    ).toBeNull();
  });

  it("will not spend a fun-dive package on a course session", () => {
    // A shop sells cheap dives to a certified diver, not cheap instruction.
    const funDivesOnly = [entitlement({ scope: "fun_dives" })];
    expect(entitlementToSpend(funDivesOnly, { courseId: "course-1" }, NOW)).toBeNull();
    expect(entitlementToSpend(funDivesOnly, { courseId: null }, NOW)?.id).toBe("e1");
  });

  it("spends an all-departures package on a course session", () => {
    expect(entitlementToSpend([entitlement({ scope: "all" })], { courseId: "c1" }, NOW)?.id).toBe(
      "e1",
    );
  });

  it("never spends one that is already consumed", () => {
    expect(
      entitlementToSpend([entitlement({ consumedAt: days(-1) })], { courseId: null }, NOW),
    ).toBeNull();
  });
});

describe("how many dives are left", () => {
  it("counts only what can still be spent", () => {
    // "4 remaining" about four lapsed dives is the complaint this feature is
    // trying not to generate.
    const held = [
      entitlement({ id: "a" }),
      entitlement({ id: "b", expiresAt: days(5) }),
      entitlement({ id: "c", expiresAt: days(-1) }),
      entitlement({ id: "d", consumedAt: days(-2) }),
    ];
    expect(spendableCount(held, NOW)).toBe(2);
  });

  it("is zero for a diver holding nothing", () => {
    expect(spendableCount([], NOW)).toBe(0);
  });
});

describe("what a package covers", () => {
  it("is a property of what the shop sold, not of the checkout", () => {
    expect(packageCoversTrip("all", { courseId: "c1" })).toBe(true);
    expect(packageCoversTrip("fun_dives", { courseId: "c1" })).toBe(false);
    expect(packageCoversTrip("fun_dives", { courseId: null })).toBe(true);
  });
});
