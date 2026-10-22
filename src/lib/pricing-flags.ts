import {
  DEFAULT_PRICING_CONFIG,
  PRICING_BOUNDS,
  type PricingConfig,
} from "@/lib/billing/pricing-plans";
import { log } from "@/lib/log";

/**
 * **The pricing test's numbers, from the environment** (ADR
 * 20261022-pricing-ab-test, amendment 3). Changing one is an edit to the value
 * in Vercel and a redeploy; nothing else runs to serve them.
 *
 * | Variable | Values | Default |
 * | --- | --- | --- |
 * | `PRICING_TEST` | `on`; anything else is off | off |
 * | `PRICING_PERCENT_SPLIT` | 0–100, percent of new visitors and shops in the percent arm | 50 |
 * | `PRICING_FLAT_MONTHLY_CENTS` | 0–100000 | 9900 |
 * | `PRICING_PERCENT_BASIS_POINTS` | 0–1000 (300 is 3%) | 300 |
 * | `PRICING_PERCENT_MONTHLY_CENTS` | 0–100000, a base fee on top of the percent | 0 |
 *
 * Each is optional and takes its default when unset or blank. **One invalid
 * value refuses them all**: the whole config falls back to the defaults with
 * the test off, because half a configuration read as a whole one could put a
 * shop on numbers nobody chose. The refusal is logged once per process, naming
 * the variables but never their values.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const NUMBER_VARIABLES = {
  PRICING_PERCENT_SPLIT: "split",
  PRICING_FLAT_MONTHLY_CENTS: "monthlyCents",
  PRICING_PERCENT_BASIS_POINTS: "basisPoints",
  PRICING_PERCENT_MONTHLY_CENTS: "monthlyCents",
} as const satisfies Record<string, keyof typeof PRICING_BOUNDS>;

type NumberVariable = keyof typeof NUMBER_VARIABLES;

export type PricingFlagsRead = {
  config: PricingConfig;
  /** The variables that were refused, in a fixed order; empty when every value was usable. */
  invalid: NumberVariable[];
};

/** Read the five variables. Pure: no logging, no cache. */
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
  const defaults = DEFAULT_PRICING_CONFIG;
  return {
    config: {
      test: env.PRICING_TEST?.trim() === "on",
      split: values.PRICING_PERCENT_SPLIT ?? defaults.split,
      flat: { monthlyCents: values.PRICING_FLAT_MONTHLY_CENTS ?? defaults.flat.monthlyCents },
      percent: {
        basisPoints: values.PRICING_PERCENT_BASIS_POINTS ?? defaults.percent.basisPoints,
        monthlyCents: values.PRICING_PERCENT_MONTHLY_CENTS ?? defaults.percent.monthlyCents,
      },
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
