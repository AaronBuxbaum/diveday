import type { DivePackageScope } from "@/db/schema";
import { nowDate } from "./clock";

/**
 * **What a shop sells when it sells "ten dives", and when one of those dives
 * may be spent** (ADR 20260822-a-package-is-entitlements-not-money).
 *
 * Framework-free and storage-free: these are the rules, and `src/db/packages.ts`
 * is what reads and writes rows by them. The unit is a *dive*, never an amount —
 * see the ADR for why stored value gets the arithmetic wrong the moment two
 * departures have different prices.
 */

/** How long a purchased package stays usable, at the outer end of reasonable. */
export const MAX_PACKAGE_VALIDITY_DAYS = 3 * 365;

/** The most dives one package may sell — a guard against a typo, not a policy. */
export const MAX_PACKAGE_DIVE_COUNT = 100;

export type DivePackageDefinition = {
  diveCount: number;
  priceCents: number;
  scope: DivePackageScope;
  /** Null never lapses — the behaviour that cannot surprise anyone. */
  validityDays: number | null;
};

/** Why a package definition was refused. The UI picks the words. */
export type DivePackageRefusal =
  | "name_required"
  | "dive_count_out_of_range"
  | "price_required"
  | "validity_out_of_range";

/**
 * A submitted package, or the reason it is not one. Refused rather than
 * clamped: a shop that typed 1000 dives and got 100 has been quietly overruled
 * about its own product, and nothing on screen would say so.
 */
export function validateDivePackage(input: {
  name: string;
  diveCount: number;
  priceCents: number;
  scope: DivePackageScope;
  validityDays: number | null;
}):
  | { ok: true; value: DivePackageDefinition & { name: string } }
  | { ok: false; reason: DivePackageRefusal } {
  const name = input.name.trim();
  if (!name) return { ok: false, reason: "name_required" };
  if (
    !Number.isInteger(input.diveCount) ||
    input.diveCount < 1 ||
    input.diveCount > MAX_PACKAGE_DIVE_COUNT
  ) {
    return { ok: false, reason: "dive_count_out_of_range" };
  }
  // Zero is not a free package, it is a package nobody paid for — and an
  // entitlement nobody paid for is a seat the shop gave away by accident.
  if (!Number.isInteger(input.priceCents) || input.priceCents < 1) {
    return { ok: false, reason: "price_required" };
  }
  if (
    input.validityDays !== null &&
    (!Number.isInteger(input.validityDays) ||
      input.validityDays < 1 ||
      input.validityDays > MAX_PACKAGE_VALIDITY_DAYS)
  ) {
    return { ok: false, reason: "validity_out_of_range" };
  }
  return {
    ok: true,
    value: {
      name,
      diveCount: input.diveCount,
      priceCents: input.priceCents,
      scope: input.scope,
      validityDays: input.validityDays,
    },
  };
}

/**
 * When a dive bought today stops being usable, or null if it never does.
 *
 * Stamped per entitlement at purchase rather than read back through the package,
 * so a later edit to the product cannot retroactively shorten a package somebody
 * already bought — the shape of surprise this whole feature has to avoid.
 */
export function entitlementExpiry(
  validityDays: number | null,
  purchasedAt = nowDate(),
): Date | null {
  if (validityDays === null) return null;
  return new Date(purchasedAt.getTime() + validityDays * 24 * 60 * 60 * 1000);
}

/**
 * Whether a package covers a departure. A read against what the shop sold — the
 * answer can never depend on when the diver books.
 *
 * `fun_dives` excludes course sessions, which is the ordinary shape: a shop
 * sells cheap dives to a certified diver, not cheap instruction.
 */
export function packageCoversTrip(
  scope: DivePackageScope,
  trip: { courseId: string | null },
): boolean {
  return scope === "all" || trip.courseId === null;
}

/** An unused dive, and whether it can still be spent. */
export type SpendableEntitlement = {
  id: string;
  packageId: string;
  scope: DivePackageScope;
  expiresAt: Date | null;
  consumedAt: Date | null;
};

/**
 * The one entitlement to spend on this departure, or null.
 *
 * **The soonest to expire, of those that cover the trip.** Not the oldest
 * purchase: a diver holding a lapsing five-pack and an open-ended ten-pack
 * should have the lapsing one spent first, or the product quietly eats the dives
 * it was most likely to eat anyway. An expiry exactly now has passed — a dive
 * good "until the 14th" is not good on the 15th, and an inclusive boundary is
 * how a diver arrives at the dock believing otherwise.
 */
export function entitlementToSpend(
  held: readonly SpendableEntitlement[],
  trip: { courseId: string | null },
  now = nowDate(),
): SpendableEntitlement | null {
  const usable = held.filter(
    (row) =>
      row.consumedAt === null &&
      packageCoversTrip(row.scope, trip) &&
      (row.expiresAt === null || row.expiresAt.getTime() > now.getTime()),
  );
  if (usable.length === 0) return null;
  return usable.reduce((soonest, row) => {
    if (soonest.expiresAt === null) return row.expiresAt === null ? soonest : row;
    if (row.expiresAt === null) return soonest;
    return row.expiresAt.getTime() < soonest.expiresAt.getTime() ? row : soonest;
  });
}

/**
 * How many dives a diver can still spend — the number both they and the shop
 * ask on day three.
 *
 * Counts only what is genuinely spendable: an expired dive is not a dive you
 * have, and saying "4 remaining" about four lapsed ones is the complaint this
 * feature is trying not to generate.
 */
export function spendableCount(held: readonly SpendableEntitlement[], now = nowDate()): number {
  return held.filter(
    (row) =>
      row.consumedAt === null &&
      (row.expiresAt === null || row.expiresAt.getTime() > now.getTime()),
  ).length;
}
