import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { earlyAccessPrice, earlyAccessPriceAmount } from "./marketing";

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
