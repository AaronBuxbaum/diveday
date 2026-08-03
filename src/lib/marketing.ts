import type { DiverMessageKey } from "@/i18n/messages";

/**
 * Public-facing product claims, as message-bundle *keys* — never words. The
 * homepage, product, and pricing pages resolve these through the request
 * locale's `diverTranslator`, so every claim renders in the visitor's own
 * language and the pages always describe the same product. Keep claims
 * constrained to workflows that are available in DiveDay today; the words
 * themselves live in `src/i18n/locales/<locale>/diver.json` under
 * `marketing.features`, `marketing.price`, `marketing.export`, and
 * `marketing.capabilities` — edit every locale together.
 *
 * This file holds structure (grouping, ordering, the price figure), following
 * the same keys-not-copy pattern as `src/lib/demo-roles.ts`: `src/lib`
 * returns codes, the UI picks the words (ADR 20260731-domain-layer-copy-leaks).
 */

export interface FeatureGroupKeys {
  eyebrow: DiverMessageKey;
  title: DiverMessageKey;
  features: readonly DiverMessageKey[];
}

export const productFeatureGroups: readonly FeatureGroupKeys[] = [
  {
    eyebrow: "marketing.features.welcome.eyebrow",
    title: "marketing.features.welcome.title",
    features: [
      "marketing.features.welcome.item1",
      "marketing.features.welcome.item2",
      "marketing.features.welcome.item3",
      "marketing.features.welcome.item4",
      "marketing.features.welcome.item5",
      "marketing.features.welcome.item6",
      "marketing.features.welcome.item7",
      "marketing.features.welcome.item8",
    ],
  },
  {
    eyebrow: "marketing.features.ready.eyebrow",
    title: "marketing.features.ready.title",
    features: [
      "marketing.features.ready.item1",
      "marketing.features.ready.item2",
      "marketing.features.ready.item3",
      "marketing.features.ready.item4",
      "marketing.features.ready.item5",
      "marketing.features.ready.item6",
      "marketing.features.ready.item7",
    ],
  },
  {
    eyebrow: "marketing.features.diveDay.eyebrow",
    title: "marketing.features.diveDay.title",
    features: [
      "marketing.features.diveDay.item1",
      "marketing.features.diveDay.item2",
      "marketing.features.diveDay.item3",
      "marketing.features.diveDay.item4",
      "marketing.features.diveDay.item5",
      "marketing.features.diveDay.item6",
      "marketing.features.diveDay.item7",
    ],
  },
  {
    eyebrow: "marketing.features.motion.eyebrow",
    title: "marketing.features.motion.title",
    features: [
      "marketing.features.motion.item1",
      "marketing.features.motion.item2",
      "marketing.features.motion.item3",
      "marketing.features.motion.item4",
      "marketing.features.motion.item5",
      "marketing.features.motion.item6",
      "marketing.features.motion.item7",
      "marketing.features.motion.item8",
    ],
  },
] as const;

/**
 * The price itself is the one figure that stays here — H-12 requires exactly
 * one source for the number, and a currency amount is not language. Every
 * word around it resolves from `marketing.price.*` in the bundles.
 */
export const earlyAccessPrice = {
  price: "$99", // i18n-exempt: currency figure, the H-12 single source — never restate elsewhere
  nameKey: "marketing.price.name",
  cadenceKey: "marketing.price.cadence",
  descriptionKey: "marketing.price.description",
  includedKeys: [
    "marketing.price.item1",
    "marketing.price.item2",
    "marketing.price.item3",
    "marketing.price.item4",
    "marketing.price.item5",
    "marketing.price.item6",
  ],
} as const satisfies {
  price: string;
  nameKey: DiverMessageKey;
  cadenceKey: DiverMessageKey;
  descriptionKey: DiverMessageKey;
  includedKeys: readonly DiverMessageKey[];
};

/**
 * The bare amount inside `earlyAccessPrice.price`, for structured data that
 * needs a number (JSON-LD offers). Derived here so the figure still has exactly
 * one source; never restate it as a literal.
 */
export const earlyAccessPriceAmount = earlyAccessPrice.price.replace(/[^\d.]/g, "");

/**
 * The full-shop export claim, shared across the marketing surfaces so they can
 * never drift apart: the pricing data-exit FAQ renders `claimKey` + `termsKey`;
 * the home export band renders `termsKey` in prose and carries the claim's
 * inventory as its itemized card (`marketing.home.exportItem*`) instead of the
 * long sentence. Contents verified against src/lib/export.ts; keep every
 * locale's rendering of these keys in sync with the bundle.
 */
export const fullShopExport = {
  claimKey: "marketing.export.claim",
  termsKey: "marketing.export.terms",
} as const satisfies { claimKey: DiverMessageKey; termsKey: DiverMessageKey };

export interface CapabilityAreaKeys {
  title: DiverMessageKey;
  items: readonly DiverMessageKey[];
}

/**
 * The whole shipped surface, by the job it does — the reference section on
 * `/product` for a buyer who has read the story and now wants the list.
 *
 * Every line is a workflow a visitor can walk in the live demo today
 * (docs/product/marketing.md, shipped-only). When a slice ships, it belongs
 * here as well as in docs/product/shipped.md; when a claim here can no longer
 * be demonstrated, it comes out. Deliberately plain: this is the section people
 * scan with a competitor's page open beside it, and it earns nothing by being
 * written like the bands above it.
 */
export const productCapabilityIndex: readonly CapabilityAreaKeys[] = [
  {
    title: "marketing.capabilities.booking.title",
    items: [
      "marketing.capabilities.booking.item1",
      "marketing.capabilities.booking.item2",
      "marketing.capabilities.booking.item3",
      "marketing.capabilities.booking.item4",
      "marketing.capabilities.booking.item5",
      "marketing.capabilities.booking.item6",
      "marketing.capabilities.booking.item7",
      "marketing.capabilities.booking.item8",
    ],
  },
  {
    title: "marketing.capabilities.divers.title",
    items: [
      "marketing.capabilities.divers.item1",
      "marketing.capabilities.divers.item2",
      "marketing.capabilities.divers.item3",
      "marketing.capabilities.divers.item4",
      "marketing.capabilities.divers.item5",
      "marketing.capabilities.divers.item6",
      "marketing.capabilities.divers.item7",
      "marketing.capabilities.divers.item8",
    ],
  },
  {
    title: "marketing.capabilities.diveDay.title",
    items: [
      "marketing.capabilities.diveDay.item1",
      "marketing.capabilities.diveDay.item2",
      "marketing.capabilities.diveDay.item3",
      "marketing.capabilities.diveDay.item4",
      "marketing.capabilities.diveDay.item5",
      "marketing.capabilities.diveDay.item6",
      "marketing.capabilities.diveDay.item7",
      "marketing.capabilities.diveDay.item8",
    ],
  },
  {
    title: "marketing.capabilities.money.title",
    items: [
      "marketing.capabilities.money.item1",
      "marketing.capabilities.money.item2",
      "marketing.capabilities.money.item3",
      "marketing.capabilities.money.item4",
      "marketing.capabilities.money.item5",
      "marketing.capabilities.money.item6",
    ],
  },
  {
    title: "marketing.capabilities.shop.title",
    items: [
      "marketing.capabilities.shop.item1",
      "marketing.capabilities.shop.item2",
      "marketing.capabilities.shop.item3",
      "marketing.capabilities.shop.item4",
      "marketing.capabilities.shop.item5",
      "marketing.capabilities.shop.item6",
      "marketing.capabilities.shop.item7",
      "marketing.capabilities.shop.item8",
    ],
  },
  {
    title: "marketing.capabilities.records.title",
    items: [
      "marketing.capabilities.records.item1",
      "marketing.capabilities.records.item2",
      "marketing.capabilities.records.item3",
      "marketing.capabilities.records.item4",
      "marketing.capabilities.records.item5",
      "marketing.capabilities.records.item6",
    ],
  },
] as const;
