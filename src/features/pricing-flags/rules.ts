import {
  DEFAULT_PRICING_CONFIG,
  PRICING_BOUNDS,
  type PricingConfig,
} from "../../lib/billing/pricing-plans";
import { log } from "../../lib/log";

/**
 * PRICING_MONTHLY_CENTS (0–100000) and PRICING_BASIS_POINTS (0–1000).
 * Neither set uses no monthly fee plus three percent. When either is set, an
 * omitted component is zero. Invalid values refuse the entire configuration.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const NUMBER_VARIABLES = {
  PRICING_MONTHLY_CENTS: "monthlyCents",
  PRICING_BASIS_POINTS: "basisPoints",
} as const satisfies Record<string, keyof typeof PRICING_BOUNDS>;

type NumberVariable = keyof typeof NUMBER_VARIABLES;

export type PricingFlagsRead = {
  config: PricingConfig;
  /** The variables that were refused, in a fixed order; empty when every value was usable. */
  invalid: NumberVariable[];
};

/** Read both optional components. Pure: no logging, no cache. */
export function readPricingFlags(env: Environment): PricingFlagsRead {
  const values = {} as Record<NumberVariable, number | null>;
  const invalid: NumberVariable[] = [];
  for (const [name, bound] of Object.entries(NUMBER_VARIABLES) as Array<
    [NumberVariable, keyof typeof PRICING_BOUNDS]
  >) {
    const raw = env[name]?.trim() ?? "";
    if (raw === "") {
      values[name] = null;
      continue;
    }
    const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    const { min, max } = PRICING_BOUNDS[bound];
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      invalid.push(name);
      values[name] = null;
    } else {
      values[name] = value;
    }
  }
  if (invalid.length > 0) return { config: DEFAULT_PRICING_CONFIG, invalid };
  if (values.PRICING_MONTHLY_CENTS === null && values.PRICING_BASIS_POINTS === null) {
    return { config: DEFAULT_PRICING_CONFIG, invalid: [] };
  }
  return {
    config: {
      monthlyCents: values.PRICING_MONTHLY_CENTS ?? 0,
      basisPoints: values.PRICING_BASIS_POINTS ?? 0,
    },
    invalid: [],
  };
}

const warned = new Set<string>();

/**
 * The config this process runs on. A refusal is logged the first time each
 * distinct set of refused variables is seen, so a bad deploy says so once
 * rather than on every render.
 */
export function pricingConfig(env: Environment = process.env): PricingConfig {
  const read = readPricingFlags(env);
  if (read.invalid.length > 0) {
    const key = read.invalid.join(",");
    if (!warned.has(key)) {
      warned.add(key);
      log("pricing_flags.invalid", "warn", { variables: key });
    }
  }
  return read.config;
}
