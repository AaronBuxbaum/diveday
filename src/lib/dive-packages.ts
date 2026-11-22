import type { DivePackageScope } from "@/db/schema";
import { isValidCalendarDate } from "./calendar-date";
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

/** The most dives one package may sell — a guard against a typo, not a policy. */
export const MAX_PACKAGE_DIVE_COUNT = 100;

export type DivePackageDefinition = {
  diveCount: number;
  priceCents: number;
  scope: DivePackageScope;
  /** Inclusive calendar date in ISO form; null never lapses. */
  validUntil: string | null;
};

/** Why a package definition was refused. The UI picks the words. */
export type DivePackageRefusal =
  | "name_required"
  | "dive_count_out_of_range"
  | "price_required"
  | "valid_until_invalid";

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
  validUntil: string | null;
  /**
   * The ceiling a line item on this shop's currency may carry
   * (`maxLineItemUnitAmountCents`). Passed in rather than imported: this module
   * is framework-free and the bound is the *order* layer's rule, so a package
   * that could not be sold is refused at the moment it is defined.
   */
  maxPriceCents: number;
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
  //
  // Bounded above too, against the same ceiling `createOrder` applies to a line
  // item. Without it, a price over ~21.5M major units overflows `int4` on
  // insert — and worse, a price the *order* would refuse could sit on the price
  // list looking sellable until someone tried to sell it
  // (`security-reviewer`, issue #706).
  if (
    !Number.isInteger(input.priceCents) ||
    input.priceCents < 1 ||
    input.priceCents > input.maxPriceCents
  ) {
    return { ok: false, reason: "price_required" };
  }
  if (input.validUntil !== null && !isValidCalendarDate(input.validUntil)) {
    return { ok: false, reason: "valid_until_invalid" };
  }
  return {
    ok: true,
    value: {
      name,
      diveCount: input.diveCount,
      priceCents: input.priceCents,
      scope: input.scope,
      validUntil: input.validUntil,
    },
  };
}

/**
 * Resolve an inclusive calendar end date to the final instant of that UTC
 * date. The package policy is date-based, not purchase-time arithmetic, so a
 * purchase at 14:32 remains usable for the whole stated date.
 *
 * Stamped per entitlement at purchase rather than read back through the package,
 * so a later edit to the product cannot retroactively shorten a package somebody
 * already bought — the shape of surprise this whole feature has to avoid.
 */
export function entitlementExpiry(validUntil: string | null): Date | null {
  if (validUntil === null) return null;
  if (!isValidCalendarDate(validUntil)) throw new Error("invalid package validUntil");
  return new Date(`${validUntil}T23:59:59.999Z`);
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

/**
 * How many of a diver's unspent dives this departure could take: the ones not
 * yet expired, on a package that covers it ({@link packageCoversTrip}).
 *
 * What the roster's payment control says before a staffer takes money for a
 * seat (issue #1697, H-20260916-unconfirmed-identity-withhold-cost): a fare already collected stands, so the moment to
 * see the package is before the cash, not after.
 */
export function spendableCountForTrip(
  held: readonly SpendableEntitlement[],
  trip: { courseId: string | null },
  now = nowDate(),
): number {
  return held.filter(
    (row) =>
      row.consumedAt === null &&
      packageCoversTrip(row.scope, trip) &&
      (row.expiresAt === null || row.expiresAt.getTime() > now.getTime()),
  ).length;
}

/** One row of {@link packageDiveGroups}: how many dives share a scope and an end date. */
export type PackageDiveGroup = {
  scope: DivePackageScope;
  /** The inclusive calendar date they can be used until; null never lapses. */
  useBy: string | null;
  count: number;
};

/**
 * **The dives a diver still holds, by what they cover and when they end**
 * (issue #4309): the optional detail under `/ready`'s compact "N package dives
 * left", for a diver whose packages differ.
 *
 * The same dives {@link spendableCount} counts, so the groups always add up to
 * the balance beside them. Soonest to end first, which is the order
 * {@link entitlementToSpend} spends them in; dives that never lapse last.
 * Within one end date, fun dives only come before dives that also cover
 * courses. A row says what a dive *may* pay for, never that a seat is held.
 *
 * `useBy` is read back from the stamp {@link entitlementExpiry} wrote (the last
 * instant of that UTC date), so it is the date the shop sold, not a guess.
 */
export function packageDiveGroups(
  held: readonly SpendableEntitlement[],
  now = nowDate(),
): PackageDiveGroup[] {
  const groups = new Map<string, PackageDiveGroup>();
  for (const row of held) {
    if (row.consumedAt !== null) continue;
    if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) continue;
    const useBy = row.expiresAt === null ? null : row.expiresAt.toISOString().slice(0, 10);
    const key = `${row.scope}|${useBy ?? ""}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { scope: row.scope, useBy, count: 1 });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.useBy !== b.useBy) {
      if (a.useBy === null) return 1;
      if (b.useBy === null) return -1;
      return a.useBy < b.useBy ? -1 : 1;
    }
    if (a.scope === b.scope) return 0;
    return a.scope === "fun_dives" ? -1 : 1;
  });
}

/**
 * Whether a package can still be sold to a diver online.
 *
 * A package whose end date has passed would grant dives that are already
 * expired the moment they are paid for, so the public page neither lists it
 * nor takes money for it. Staff can still see it in Settings.
 */
export function packageOnSale(
  pkg: { validUntil: string | null; deletedAt?: Date | null },
  now = nowDate(),
): boolean {
  if (pkg.deletedAt) return false;
  const expiry = entitlementExpiry(pkg.validUntil);
  return expiry === null || expiry.getTime() > now.getTime();
}

/**
 * **What one dive costs bought singly** (issue #4388): the per-tank price most
 * of the shop's departures on sale charge, a dive being one tank
 * (H-20261014-package-dive-is-a). A tie takes the lower price, so the saving a
 * package claims against it is never overstated. Null when no departure
 * carries a price to compare with; then the package says nothing about saving.
 * Fractional cents are kept: a three-tank $100 day is $33.333… a tank, and
 * only the saving is rounded.
 */
export function singleDivePrice(
  departures: readonly { priceCents: number | null; plannedDives: number }[],
): number | null {
  const tally = new Map<number, number>();
  for (const { priceCents, plannedDives } of departures) {
    if (!priceCents || priceCents <= 0 || plannedDives <= 0) continue;
    const perTank = priceCents / plannedDives;
    tally.set(perTank, (tally.get(perTank) ?? 0) + 1);
  }
  let best: { perTank: number; count: number } | null = null;
  for (const [perTank, count] of tally) {
    if (!best || count > best.count || (count === best.count && perTank < best.perTank)) {
      best = { perTank, count };
    }
  }
  return best?.perTank ?? null;
}

/**
 * What a package saves against its dives bought singly, in whole cents. Null
 * when nothing compares or it saves nothing: a package is never said to save
 * a negative amount, and no saving is typed by hand.
 */
export function packageSavingCents(
  pkg: { priceCents: number; diveCount: number },
  singleDiveCents: number | null,
): number | null {
  if (singleDiveCents === null) return null;
  const saving = Math.floor(singleDiveCents * pkg.diveCount - pkg.priceCents);
  return saving > 0 ? saving : null;
}
