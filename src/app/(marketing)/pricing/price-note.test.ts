import { describe, expect, it } from "vitest";
import { planCopyParams } from "@/features/money/billing";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { configuredPricing, type PricingConfig } from "@/lib/billing/pricing-plans";

/**
 * **The fee is the configuration's, never the bundle's** (ADR
 * 20261124-free-shops-no-trial). The /pricing note and the /onboard line take
 * their figures from the one pricing configuration (`PRICING_*`, read by
 * `pricingConfig()`), so changing the price changes every sentence that states
 * it. Each is rendered here for several configurations and must read true for
 * each: free and percent-only, another percent, a monthly base with a percent,
 * and a monthly base alone.
 */
function render(locale: (typeof DIVER_LOCALES)[number], config: PricingConfig) {
  const t = diverTranslator(locale);
  const params = planCopyParams(configuredPricing(config), locale);
  return {
    pricing: t("marketing.pricing.priceNote", params),
    onboard: t("account.onboard.priceNote", params),
  };
}

const FREE_ONE_PERCENT = { monthlyCents: 0, basisPoints: 100 };
const FREE_TWO_AND_A_HALF = { monthlyCents: 0, basisPoints: 250 };
const BASE_AND_PERCENT = { monthlyCents: 2_900, basisPoints: 100 };
const BASE_ONLY = { monthlyCents: 4_900, basisPoints: 0 };

describe("the price lines follow the pricing configuration", () => {
  it("say free, no card and 1% under today's configuration", () => {
    expect(render("en-US", FREE_ONE_PERCENT)).toEqual({
      pricing:
        "Keep your booking tool and try DiveDay on one trip. It’s free, with no card. If you take payments in DiveDay, we keep 1%, and that’s the whole price.",
      onboard: "It’s free, with no card, and we keep 1% only of payments you take in DiveDay.",
    });
    const es = render("es-ES", FREE_ONE_PERCENT);
    expect(es.pricing).toMatch(/Es gratis y sin tarjeta\. .*el 1\s%, y ese es todo el precio\.$/);
    expect(es.onboard).toMatch(/^Es gratis y sin tarjeta, y solo nos quedamos con el 1\s%/);
  });

  it("change their figure when the percent changes", () => {
    const en = render("en-US", FREE_TWO_AND_A_HALF);
    expect(en.pricing).toContain("we keep 2.5%, and that’s the whole price.");
    expect(en.onboard).toContain("we keep 2.5% only of payments");
    for (const locale of DIVER_LOCALES) {
      const lines = render(locale, FREE_TWO_AND_A_HALF);
      expect(`${lines.pricing} ${lines.onboard}`).not.toMatch(/\b1\s?%/);
    }
  });

  it("stop saying free once a monthly base is configured", () => {
    const en = render("en-US", BASE_AND_PERCENT);
    expect(en.pricing).toBe(
      "Keep your booking tool and try DiveDay on one trip. It’s $29 a month, and if you take payments in DiveDay, we also keep 1%.",
    );
    expect(en.onboard).toBe("It’s $29 a month, plus 1% of payments you take in DiveDay.");
    for (const locale of DIVER_LOCALES) {
      const lines = render(locale, BASE_AND_PERCENT);
      expect(`${lines.pricing} ${lines.onboard}`).not.toMatch(/free|no card|gratis|sin tarjeta/i);
    }
  });

  it("name no percent when only a monthly base is configured", () => {
    const en = render("en-US", BASE_ONLY);
    expect(en.pricing).toBe(
      "Keep your booking tool and try DiveDay on one trip. It’s $49 a month, with no other fee.",
    );
    expect(en.onboard).toBe("It’s $49 a month.");
    expect(render("es-ES", BASE_ONLY).onboard).toMatch(/^Cuesta 49\sUS\$ al mes\.$/);
  });

  it.each(DIVER_LOCALES)(
    "keep the /onboard line one sentence in %s, whatever the price",
    (locale) => {
      for (const config of [FREE_ONE_PERCENT, FREE_TWO_AND_A_HALF, BASE_AND_PERCENT, BASE_ONLY]) {
        const { onboard } = render(locale, config);
        // A decimal percent ("2.5%") is not a sentence end.
        expect(onboard.replace(/\d\.\d/g, "").match(/[.!?]/g)).toHaveLength(1);
        expect(onboard.endsWith(".")).toBe(true);
      }
    },
  );
});
