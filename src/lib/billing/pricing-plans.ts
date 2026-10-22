import { createHash } from "node:crypto";
import { earlyAccessPriceAmount } from "@/lib/marketing";

/**
 * **The pricing A/B test's two plans** (ADR 20261022-pricing-ab-test): what a
 * shop pays DiveDay, either a flat monthly fee or a share of the card money it
 * took through DiveDay that month, optionally on top of a smaller monthly base
 * fee.
 *
 * Pure. The numbers come from the `pricing` flag (`./pricing-flags.ts`, read
 * from AWS Parameter Store by `./pricing-flags-reader.ts`); this module decides
 * which plan a shop is on and what it owes from what is stored, the flag and
 * the shop's id. The pages, the cron and the scripts only ask. With the flag
 * absent, unreadable or invalid the numbers are `DEFAULT_PRICING_CONFIG`: the
 * test off and the flat price every shop pays today.
 */

export const PRICING_PLANS = ["flat_monthly", "percent_of_volume"] as const;
export type PricingPlan = (typeof PRICING_PLANS)[number];

/** Who put a stored plan on a shop: the arm it was assigned, or a person by hand. */
export const PRICING_PLAN_SOURCES = ["assigned", "override"] as const;
export type PricingPlanSource = (typeof PRICING_PLAN_SOURCES)[number];

/**
 * Today's flat monthly amount in cents, derived from the one published price
 * (`earlyAccessPrice`, H-12's single source), never restated. The flag's
 * default, and the amount the existing `BILLING_STRIPE_PRICE_ID` charges.
 */
export const FLAT_MONTHLY_CENTS = Math.round(Number(earlyAccessPriceAmount) * 100);

/** The bounds every number in the flag (and every per-shop deal) is held to. */
export const PRICING_BOUNDS = {
  monthlyCents: { min: 0, max: 100_000 },
  basisPoints: { min: 0, max: 1_000 },
  split: { min: 0, max: 100 },
} as const;

/** The numbers the test runs on. */
export type PricingConfig = {
  /** Whether the percent arm exists at all. Off, everyone is on the flat plan. */
  test: boolean;
  /** Percent of new visitors and shops put in the percent arm, 0–100. */
  split: number;
  flat: { monthlyCents: number };
  /** `basisPoints` of the month's volume (300 is 3%), plus `monthlyCents` as a base fee. */
  percent: { basisPoints: number; monthlyCents: number };
};

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  test: false,
  split: 50,
  flat: { monthlyCents: FLAT_MONTHLY_CENTS },
  percent: { basisPoints: 300, monthlyCents: 0 },
};

/** What one shop pays: a monthly fee, and a share of its volume (0 on the flat plan). */
export type PlanTerms = {
  plan: PricingPlan;
  monthlyCents: number;
  basisPoints: number;
};

export function isPricingPlan(value: unknown): value is PricingPlan {
  return typeof value === "string" && (PRICING_PLANS as readonly string[]).includes(value);
}

/** The flag's numbers for one plan. */
export function termsFor(plan: PricingPlan, config: PricingConfig): PlanTerms {
  return plan === "flat_monthly"
    ? { plan, monthlyCents: config.flat.monthlyCents, basisPoints: 0 }
    : {
        plan,
        monthlyCents: config.percent.monthlyCents,
        basisPoints: config.percent.basisPoints,
      };
}

/**
 * Whether terms are exactly today's: the flat plan at the published price.
 * Those terms render the canonical figure and check out on the existing
 * Stripe price, so the defaults change nothing anyone sees or pays.
 */
export function isTodaysPrice(terms: PlanTerms): boolean {
  return (
    terms.plan === "flat_monthly" && terms.monthlyCents === FLAT_MONTHLY_CENTS && !terms.basisPoints
  );
}

/** A key's bucket, 0–99, from the first four bytes of its SHA-256. */
export function pricingBucket(key: string): number {
  return createHash("sha256").update(key).digest().readUInt32BE(0) % 100;
}

/**
 * A deterministic split: the key's bucket below `split` is the percent arm.
 * The same key always lands in the same arm at the same split, so a shop with
 * nothing stored reads one plan on every page and every run of the cron.
 */
export function pricingPlanForKey(key: string, split: number): PricingPlan {
  return pricingBucket(key) < split ? "percent_of_volume" : "flat_monthly";
}

/** A random arm for a new visitor, at the flag's split. */
export function randomPricingPlan(split: number, random: () => number = Math.random): PricingPlan {
  return Math.floor(random() * 100) < split ? "percent_of_volume" : "flat_monthly";
}

/** What `shop_subscriptions` holds about a shop's plan. */
export type StoredPricing = {
  plan: string | null;
  source: string | null;
  /** The numbers snapshotted when Checkout opened or a deal was set by hand. */
  monthlyCents: number | null;
  basisPoints: number | null;
};

/**
 * The plan and numbers a shop is on, in this order:
 *
 * 1. **A live subscription keeps what it was sold** (grandfathering): its
 *    snapshot, or, with none, today's flat price, because a subscription with
 *    no snapshot was opened before the test existed on the one price there was.
 * 2. **An override is a deal made by hand** and stands whether or not the test
 *    is on: its snapshot, or the flag's numbers for that plan.
 * 3. **Test off**: the flat plan at the flag's flat fee. A stored arm is kept,
 *    so turning the test back on restores it.
 * 4. The stored arm, or the shop id's bucket at the flag's split, on the
 *    flag's numbers for that plan.
 */
export function effectivePricing(input: {
  stored: StoredPricing | null;
  shopId: string;
  config: PricingConfig;
  hasLiveSubscription: boolean;
}): PlanTerms {
  const { stored, config } = input;
  const storedPlan = isPricingPlan(stored?.plan) ? stored.plan : null;
  const snapshot = (plan: PricingPlan): PlanTerms | null =>
    stored?.monthlyCents != null
      ? {
          plan,
          monthlyCents: stored.monthlyCents,
          basisPoints: plan === "percent_of_volume" ? (stored.basisPoints ?? 0) : 0,
        }
      : null;
  if (input.hasLiveSubscription) {
    return (storedPlan && snapshot(storedPlan)) ?? termsFor("flat_monthly", DEFAULT_PRICING_CONFIG);
  }
  if (storedPlan && stored?.source === "override") {
    return snapshot(storedPlan) ?? termsFor(storedPlan, config);
  }
  if (!config.test) return termsFor("flat_monthly", config);
  return termsFor(storedPlan ?? pricingPlanForKey(input.shopId, config.split), config);
}

/**
 * The percent plan's fee on a month's volume, in whole cents: `basisPoints`
 * of it, half a cent rounded up, never below zero (a month whose refunds
 * outweigh its sales owes nothing, and carries nothing into the next).
 * Integer arithmetic only.
 */
export function percentFeeCents(volumeCents: number, basisPoints: number): number {
  if (!Number.isFinite(volumeCents) || !Number.isInteger(basisPoints)) return 0;
  const volume = Math.trunc(volumeCents);
  if (volume <= 0 || basisPoints <= 0) return 0;
  return Math.floor((volume * basisPoints + 5_000) / 10_000);
}

/** Whether a number sits inside one of `PRICING_BOUNDS`, as a whole number. */
export function withinBounds(value: number, bound: keyof typeof PRICING_BOUNDS): boolean {
  const { min, max } = PRICING_BOUNDS[bound];
  return Number.isInteger(value) && value >= min && value <= max;
}

export type PricingPlanArgs = {
  shopSlug: string;
  /** The plan to set, or null for `auto`. */
  plan: PricingPlan | null;
  monthlyCents: number | null;
  basisPoints: number | null;
};

const PLAN_WORDS: Record<string, PricingPlan | null> = {
  flat: "flat_monthly",
  percent: "percent_of_volume",
  auto: null,
};

/**
 * `pnpm billing:pricing-plan <shop-slug> <flat|percent|auto> [--monthly-cents N]
 * [--basis-points N]`, read. A deal's numbers are held to the flag's bounds;
 * `auto` takes none, and `--basis-points` only goes with `percent`.
 */
export function parsePricingPlanArgs(
  argv: readonly string[],
): { ok: true; args: PricingPlanArgs } | { ok: false; error: string } {
  const [shopSlug, word, ...rest] = argv;
  if (!shopSlug || !word || !(word in PLAN_WORDS)) {
    return { ok: false, error: "usage" };
  }
  const plan = PLAN_WORDS[word] ?? null;
  let monthlyCents: number | null = null;
  let basisPoints: number | null = null;
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const raw = rest[index + 1];
    const value = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (flag === "--monthly-cents" && monthlyCents === null) {
      if (!withinBounds(value, "monthlyCents")) return { ok: false, error: "monthly_cents" };
      monthlyCents = value;
    } else if (flag === "--basis-points" && basisPoints === null) {
      if (!withinBounds(value, "basisPoints")) return { ok: false, error: "basis_points" };
      basisPoints = value;
    } else {
      return { ok: false, error: "usage" };
    }
  }
  if (plan === null && (monthlyCents !== null || basisPoints !== null)) {
    return { ok: false, error: "auto_takes_no_numbers" };
  }
  if (plan === "flat_monthly" && basisPoints !== null) {
    return { ok: false, error: "flat_takes_no_basis_points" };
  }
  return { ok: true, args: { shopSlug, plan, monthlyCents, basisPoints } };
}
