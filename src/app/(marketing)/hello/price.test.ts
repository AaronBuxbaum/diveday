import { describe, expect, it } from "vitest";
import { planCopyParams } from "@/features/money/billing";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { configuredPricing, type PricingConfig } from "@/lib/billing/pricing-plans";

/**
 * `/hello`'s price line takes its figures from the pricing configuration, as
 * every price sentence does (ADR 20261124-free-shops-no-trial), and says a trip
 * paid for elsewhere costs nothing only while there is no monthly base.
 */
function line(locale: (typeof DIVER_LOCALES)[number], config: PricingConfig) {
  return diverTranslator(locale)(
    "marketing.hello.price",
    planCopyParams(configuredPricing(config), locale),
  );
}

describe("the /hello price line", () => {
  it("says free, 1% of payments taken in DiveDay, and nothing for a trip paid elsewhere", () => {
    expect(line("en-US", { monthlyCents: 0, basisPoints: 100 })).toBe(
      "It’s free, and DiveDay keeps 1% only of payments you take in DiveDay, so a trip your divers paid for somewhere else costs you nothing.",
    );
    expect(line("es-ES", { monthlyCents: 0, basisPoints: 100 })).toMatch(
      /^Es gratis, .*no te cuesta nada\.$/,
    );
  });

  it("follows a changed percent", () => {
    expect(line("en-US", { monthlyCents: 0, basisPoints: 250 })).toContain("keeps 2.5% only");
  });

  it("stops saying free, and drops the paid-elsewhere promise, once a monthly base is set", () => {
    for (const locale of DIVER_LOCALES) {
      const text = line(locale, { monthlyCents: 2_900, basisPoints: 100 });
      expect(text).not.toMatch(/free|nothing|gratis|nada/i);
    }
    expect(line("en-US", { monthlyCents: 4_900, basisPoints: 0 })).toBe("It’s $49 a month.");
  });
});
