import { earlyAccessPriceAmount } from "@/lib/marketing";

/** Configured monthly fee plus a share of money recorded received by any method. */
export const PRICING_PLANS = ["flat_monthly", "percent_of_volume"] as const;
export type PricingPlan = (typeof PRICING_PLANS)[number];

/** Who put a stored plan on a shop: the offer it was assigned, or a person by hand. */
export const PRICING_PLAN_SOURCES = ["assigned", "override"] as const;
export type PricingPlanSource = (typeof PRICING_PLAN_SOURCES)[number];

/**
 * The original flat monthly amount in cents, derived from the original published price
 * (`earlyAccessPrice`, H-20260724-public-founding-shop-price's single source), never restated. The config's
 * legacy fallback, and the amount the existing `BILLING_STRIPE_PRICE_ID` charges.
 */
export const FLAT_MONTHLY_CENTS = Math.round(Number(earlyAccessPriceAmount) * 100);

/** The bounds every number in the config (and every per-shop deal) is held to. */
export const PRICING_BOUNDS = {
  monthlyCents: { min: 0, max: 100_000 },
  basisPoints: { min: 0, max: 1_000 },
} as const;

/** The single offer used for new subscriptions and public pricing. */
export type PricingConfig = { monthlyCents: number; basisPoints: number };

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  monthlyCents: 0,
  basisPoints: 300,
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

/** The config's numbers for one plan. */
export function termsFor(plan: PricingPlan, config: PricingConfig): PlanTerms {
  return {
    plan,
    monthlyCents: config.monthlyCents,
    basisPoints: plan === "percent_of_volume" ? config.basisPoints : 0,
  };
}

/** Every new subscriber sees the same terms; a percentage adds to any monthly fee. */
export function configuredPricing(config: PricingConfig): PlanTerms {
  return termsFor(config.basisPoints > 0 ? "percent_of_volume" : "flat_monthly", config);
}

/**
 * Whether terms match the original flat offer. Those terms render the legacy
 * canonical figure and check out on the existing Stripe price.
 */
export function isTodaysPrice(terms: PlanTerms): boolean {
  return (
    terms.plan === "flat_monthly" && terms.monthlyCents === FLAT_MONTHLY_CENTS && !terms.basisPoints
  );
}

/** What `shop_subscriptions` holds about a shop's plan. */
export type StoredPricing = {
  plan: string | null;
  source: string | null;
  /** The numbers snapshotted when Checkout opened or a deal was set by hand. */
  monthlyCents: number | null;
  basisPoints: number | null;
};

/** Live subscriptions and explicit deals retain their terms; other shops use the configured offer. */
export function effectivePricing(input: {
  stored: StoredPricing | null;
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
    return (
      (storedPlan && snapshot(storedPlan)) ?? {
        plan: "flat_monthly",
        monthlyCents: FLAT_MONTHLY_CENTS,
        basisPoints: 0,
      }
    );
  }
  if (storedPlan && stored?.source === "override") {
    return snapshot(storedPlan) ?? termsFor(storedPlan, config);
  }
  return configuredPricing(config);
}

/**
 * The percent plan's fee on a month's volume, in whole cents: `basisPoints`
 * of it, half a cent rounded up, never below zero (a month whose refunds
 * outweigh its sales owes nothing; statement fee credits carry separately).
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
 * [--basis-points N]`, read. A deal's numbers are held to the config's bounds;
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
    const option = rest[index];
    const raw = rest[index + 1];
    const value = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (option === "--monthly-cents" && monthlyCents === null) {
      if (!withinBounds(value, "monthlyCents")) return { ok: false, error: "monthly_cents" };
      monthlyCents = value;
    } else if (option === "--basis-points" && basisPoints === null) {
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

/**
 * The monthly close (`/api/cron/pricing-volume`): 14:08, 18:08 and 22:08 UTC
 * on the 2nd and 3rd. By then every zone's month has ended and a late refund
 * recorded on the 1st is in. The 2nd's later runs retry a lost answer inside
 * Stripe's 24-hour identifier window; the 3rd's are the last resort, and ask
 * the meter before they send (`REPORT_RECHECK_AFTER_MS`). Restated in
 * vercel.json, and `src/lib/cron-schedule.test.ts` holds the two together.
 */
export const PRICING_CLOSE_CRONTAB = "8 14,18,22 2,3 * *";
