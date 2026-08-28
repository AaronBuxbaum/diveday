import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { earlyAccessPrice, earlyAccessPriceAmount, midSeasonCutover } from "./marketing";

describe("earlyAccessPriceAmount", () => {
  // JSON-LD offers need a bare number; it must stay a derivation of the one
  // price source, never drift into a second hand-written figure.
  it("derives a bare numeric amount from the single price source", () => {
    expect(earlyAccessPriceAmount).toMatch(/^\d+(\.\d+)?$/);
    expect(earlyAccessPrice.price).toContain(earlyAccessPriceAmount);
  });
});

/** Every `marketing.*` leaf in one locale, as `dotted.path` → message. */
function marketingMessages(locale: (typeof DIVER_LOCALES)[number]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
    } else {
      out[path] = String(node);
    }
  };
  walk(DIVER_MESSAGES[locale].marketing, "marketing");
  return out;
}

/**
 * H-12's single-source rule, enforced where it is easiest to break it: the
 * message bundles. `earlyAccessPrice.price` is the one place the figure exists
 * (docs/product/marketing.md, "The price renders only from src/lib/marketing.ts"),
 * so a sentence that shows it must interpolate it — a bundle that spells the
 * number out reads correctly the day it is written and is a stale claim the day
 * the price moves, in a file no pricing change would think to open.
 *
 * The rule got its test when the flat price reached the homepage hero
 * (docs/product/marketing-review-20260827.md, "The price reaches the first
 * screen"): the number now renders on two bands of `/` rather than one, and
 * both render it the same way.
 */
describe("the price is interpolated, never spelled out in a bundle", () => {
  /** The two sentences that carry the figure — the hero and the closing band of `/`. */
  const priceSentenceKeys = ["marketing.home.heroPriceLine", "marketing.home.priceLine"] as const;

  for (const locale of DIVER_LOCALES) {
    it(`keeps every marketing message in ${locale} free of a currency figure`, () => {
      const offenders = Object.entries(marketingMessages(locale))
        .filter(
          ([, message]) =>
            message.includes(earlyAccessPrice.price) ||
            message.includes(earlyAccessPriceAmount) ||
            /\p{Sc}\s?\d/u.test(message),
        )
        .map(([key]) => key);
      expect(offenders).toEqual([]);
    });

    it(`renders the price through {price} and {cadence} in ${locale}`, () => {
      const messages = marketingMessages(locale);
      for (const key of priceSentenceKeys) {
        expect(messages[key]).toBeDefined();
        expect(messages[key]).toContain("{price}");
        expect(messages[key]).toContain("{cadence}");
      }
    });
  }
});

/**
 * One claim at two lengths: the switching guides walk the mid-season move as
 * the four phases of `guides.shared.cutover.*`, and the homepage's records
 * band compresses the same promise into one sentence. That sentence is a key
 * in the guides' namespace rather than a homepage wording of the same thing
 * (docs/product/marketing.md, "A claim used on more than one page belongs in
 * src/lib/marketing.ts as a shared *key*"). These pin both halves: where the
 * key lives, and that no `marketing.home.*` message duplicates it.
 */
describe("the mid-season answer is one shared key", () => {
  it("lives in the guides' cutover namespace, beside the steps it compresses", () => {
    expect(midSeasonCutover.claimKey).toMatch(/^marketing\.guides\.shared\.cutover\./);
  });

  for (const locale of DIVER_LOCALES) {
    it(`resolves to a sentence in ${locale}`, () => {
      const message = marketingMessages(locale)[midSeasonCutover.claimKey];
      expect(message).toBeDefined();
      expect(message.length).toBeGreaterThan(40);
    });
  }

  /**
   * The silence this claim depends on: no `marketing.home.*` message may
   * restate it. A homepage wording of the same promise is exactly what the
   * shared key exists to stop, and it would drift the first time the cutover
   * steps were edited — the failure mode marketing.md names one namespace
   * over for the export claim ("Never let a surface restate the export claim
   * in its own words").
   */
  for (const locale of DIVER_LOCALES) {
    it(`is not restated by a homepage message in ${locale}`, () => {
      const messages = marketingMessages(locale);
      const shared = messages[midSeasonCutover.claimKey];
      const restatements = Object.entries(messages)
        .filter(([key]) => key.startsWith("marketing.home."))
        .filter(([, message]) => message === shared)
        .map(([key]) => key);
      expect(restatements).toEqual([]);
    });
  }
});
