import { describe, expect, it } from "vitest";
import {
  entitlementExpiry,
  entitlementToSpend,
  MAX_PACKAGE_DIVE_COUNT,
  packageCoversTrip,
  packageOnSale,
  type SpendableEntitlement,
  spendableCount,
  spendableCountForTrip,
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
  // The USD line-item ceiling, so these cases are about the rules rather than
  // the bound; the bound has its own case below.
  const MAX = 999_999_99;
  const base = {
    name: "Ten dives",
    diveCount: 10,
    priceCents: 90_000,
    scope: "all" as const,
    validUntil: null,
    maxPriceCents: MAX,
  };

  it("accepts the ordinary product", () => {
    const result = validateDivePackage(base);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(result.value.name).toBe("Ten dives");
    expect(result.value.validUntil).toBeNull();
  });

  it("refuses a package nobody paid for", () => {
    // Zero is not a free package; it is an entitlement nobody paid for, which
    // is a seat the shop gave away by accident.
    const result = validateDivePackage({ ...base, priceCents: 0 });
    expect(result).toEqual({ ok: false, reason: "price_required" });
  });

  it("refuses a price the order layer would not accept", () => {
    // Otherwise a package that cannot be sold sits on the price list looking
    // sellable until somebody tries — and a big enough number overflows `int4`
    // on insert rather than being refused.
    expect(validateDivePackage({ ...base, priceCents: MAX + 1 })).toEqual({
      ok: false,
      reason: "price_required",
    });
    expect(validateDivePackage({ ...base, priceCents: MAX }).ok).toBe(true);
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

  it("refuses an invalid end date, and keeps null meaning never", () => {
    expect(validateDivePackage({ ...base, validUntil: "2026-02-30" })).toEqual({
      ok: false,
      reason: "valid_until_invalid",
    });
    const forever = validateDivePackage({ ...base, validUntil: null });
    expect(forever.ok).toBe(true);
  });
});

describe("when a dive stops being usable", () => {
  it("uses the whole fixed end date rather than purchase-time arithmetic", () => {
    expect(entitlementExpiry("2026-08-31")).toEqual(new Date("2026-08-31T23:59:59.999Z"));
    expect(entitlementExpiry(null)).toBeNull();
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

describe("packageOnSale", () => {
  it("sells a package with no end date, or one that ends later", () => {
    expect(packageOnSale({ validUntil: null }, NOW)).toBe(true);
    expect(packageOnSale({ validUntil: "2026-08-22" }, NOW)).toBe(true);
  });

  it("never sells dives that would already be expired when paid for", () => {
    expect(packageOnSale({ validUntil: "2026-08-21" }, NOW)).toBe(false);
  });

  it("never sells a package the shop stopped selling", () => {
    expect(packageOnSale({ validUntil: null, deletedAt: days(-1) }, NOW)).toBe(false);
  });
});

/**
 * What the roster's payment control counts before a fare is taken (issue
 * #1697): only dives this departure could actually take.
 */
describe("spendableCountForTrip", () => {
  const funDive = { courseId: null };
  const course = { courseId: "course-1" };

  it("counts unspent, unexpired dives on a package that covers the trip", () => {
    const held = [
      entitlement({ id: "a" }),
      entitlement({ id: "b", expiresAt: days(3) }),
      entitlement({ id: "c", consumedAt: days(-1) }),
      entitlement({ id: "d", expiresAt: days(-1) }),
    ];
    expect(spendableCountForTrip(held, funDive, NOW)).toBe(2);
  });

  it("leaves out a fun-dive package on a course session", () => {
    const held = [entitlement({ id: "a", scope: "fun_dives" }), entitlement({ id: "b" })];
    expect(spendableCountForTrip(held, course, NOW)).toBe(1);
    expect(spendableCountForTrip(held, funDive, NOW)).toBe(2);
  });

  it("treats a dive expiring exactly now as gone", () => {
    expect(spendableCountForTrip([entitlement({ expiresAt: NOW })], funDive, NOW)).toBe(0);
  });
});
