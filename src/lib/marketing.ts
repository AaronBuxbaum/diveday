import type { DiverMessageKey } from "@/i18n/messages";
import { openGraphSite } from "@/lib/site-metadata";

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

/**
 * The Open Graph fields every marketing page needs and cannot inherit:
 * `openGraphSite` (see `src/lib/site-metadata.ts` for why a page-level
 * `openGraph` block drops it) plus the shared link card itself.
 *
 * File-based image metadata is collected per segment, so the root card is
 * re-attached only to pages in the root segment (`/`). Every other marketing
 * route names it here instead. `/` deliberately does not spread this: its own
 * segment supplies the file, and Next's generated URL carries a cache-busting
 * id this hand-written path can't — it spreads `openGraphSite` directly.
 *
 * Setting it explicitly is safe either way — if a field would have been
 * inherited, restating it changes nothing.
 */
export const sharedLinkCard = {
  ...openGraphSite,
  // The route Next generates for `src/app/opengraph-image.tsx`; resolved
  // against `metadataBase` (set in `src/app/layout.tsx`). Dimensions mirror the
  // `size` that file exports — keep the three in step.
  images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
};

export interface FeatureGroupKeys {
  eyebrow: DiverMessageKey;
  title: DiverMessageKey;
  /**
   * One paragraph for the group's card — a summary written as a summary.
   *
   * This used to be `features: readonly DiverMessageKey[]`, a checklist of
   * seven or eight claims per group, and `FeatureGroupsGrid` chose between a
   * checklist and a paragraph by how many of them a caller asked for. When
   * `/product`'s middle density was removed on 2026-08-13 both remaining
   * callers settled on `featuresPerGroup={1}`, which meant only `item1` of
   * each group could reach a page — 26 keys, translated in two locales,
   * rendering nowhere, and a checklist branch that nothing could execute.
   *
   * The card paragraph is now its own string rather than the first line of a
   * list read out of context: three of the four `item1`s were written as list
   * openers, so as summaries they were thinner than a sentence written for
   * the job. The full inventory a buyer wants is `productCapabilityIndex`,
   * rendered flat on `/product` — one density per page, and the way to add a
   * list to a page is to check the other density first
   * (docs/product/marketing.md).
   */
  summary: DiverMessageKey;
}

export const productFeatureGroups: readonly FeatureGroupKeys[] = [
  {
    eyebrow: "marketing.features.welcome.eyebrow",
    title: "marketing.features.welcome.title",
    summary: "marketing.features.welcome.summary",
  },
  {
    eyebrow: "marketing.features.ready.eyebrow",
    title: "marketing.features.ready.title",
    summary: "marketing.features.ready.summary",
  },
  {
    eyebrow: "marketing.features.diveDay.eyebrow",
    title: "marketing.features.diveDay.title",
    summary: "marketing.features.diveDay.summary",
  },
  {
    eyebrow: "marketing.features.motion.eyebrow",
    title: "marketing.features.motion.title",
    summary: "marketing.features.motion.summary",
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
  // Five things the price covers, every one of them a thing rather than a
  // reassurance. `item5` ("no surprise increases while you help shape what
  // ships next") was retired on 2026-08-28: under a heading reading "What the
  // price covers" it was the one negation among positives, and once the
  // two-year lock moved under the figure (`marketing.pricing.lockNote`) what
  // it still carried was a founding-cohort rationale rather than something the
  // price buys — `faq.whyFounding` says that whole. The numbering is
  // deliberately not resequenced: `item6` keeps naming the string it has
  // always named.
  includedKeys: [
    "marketing.price.item1",
    "marketing.price.item2",
    "marketing.price.item3",
    "marketing.price.item4",
    "marketing.price.item6",
  ],
} as const satisfies {
  price: string;
  nameKey: DiverMessageKey;
  cadenceKey: DiverMessageKey;
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

/**
 * The mid-season answer, rendered on the homepage's records band
 * (docs/product/marketing-review-20260827.md, "Mid-season answered where it
 * disqualifies"). One claim, told at two lengths: the switching guides walk it
 * as the steps of `guides.shared.cutover.*`, and `/` compresses the same
 * promise to a sentence for a reader who will never open a guide.
 *
 * So the key deliberately lives in the **guides'** namespace rather than the
 * homepage's, and this constant is what makes that legible at the call site:
 * every clause in the sentence is a compression of
 * `guides.shared.cutover.step1`, `step3` and `step4`, so an editor rewriting
 * that cutover rail is reading the homepage's sentence in the same
 * block of the bundle and cannot leave it behind. Two wordings of one promise
 * is the failure this prevents — the rule marketing.md states one namespace
 * over for the export claim ("Never let a surface restate the export claim in
 * its own words"), which is why this reads like `fullShopExport` above.
 *
 * The guides do **not** additionally render this sentence: beside the steps
 * it summarizes, it would be a caption restating its own section.
 */
export const midSeasonCutover = {
  claimKey: "marketing.guides.shared.cutover.midSeason",
} as const satisfies { claimKey: DiverMessageKey };

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
 *
 * **It is the full inventory, not a highlight reel.** Until 2026-09-01 this
 * held 49 lines in seven groups — one chosen line per area, which read as
 * precise and left a buyer with the incumbent's feature page open counting
 * what was missing: no reminders, no night-before brief, no buddy teams, no
 * blow-out cascade, no close-out, no backups, no calendar feeds, no
 * QuickBooks/Shopify/Zapier, no two-factor. All of it had shipped. The band's
 * own heading promises "the whole list", so the list is now the whole of
 * docs/product/shipped.md consolidated: every shipped workflow, once, under
 * the group it belongs to. The bar for a line is unchanged (walkable in the
 * demo, in the buyer's words); the bar for *leaving one out* is that it is
 * not a thing a shop would ever look for. The page counts these off the
 * registry, so the sentence introducing the list never drifts from it.
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
      "marketing.capabilities.booking.item9",
      "marketing.capabilities.booking.item10",
      "marketing.capabilities.booking.item11",
      "marketing.capabilities.booking.item12",
      "marketing.capabilities.booking.item13",
      "marketing.capabilities.booking.item14",
      "marketing.capabilities.booking.item15",
      "marketing.capabilities.booking.item16",
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
      "marketing.capabilities.divers.item9",
      "marketing.capabilities.divers.item10",
      "marketing.capabilities.divers.item11",
      "marketing.capabilities.divers.item12",
      "marketing.capabilities.divers.item13",
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
      "marketing.capabilities.diveDay.item9",
      "marketing.capabilities.diveDay.item10",
      "marketing.capabilities.diveDay.item11",
      "marketing.capabilities.diveDay.item12",
      "marketing.capabilities.diveDay.item13",
      "marketing.capabilities.diveDay.item14",
      "marketing.capabilities.diveDay.item15",
      "marketing.capabilities.diveDay.item16",
    ],
  },
  {
    // The gear register is opt-in by presence (ADR 20260815-minimal-gear-register):
    // a shop with zero `gear_items` rows sees none of this. It is listed anyway
    // because the seeded demo fleet makes every line here walkable today, and the
    // absence of item tracking is what competitive-analysis.md names as the
    // disqualifier for a gear-heavy shop.
    title: "marketing.capabilities.gear.title",
    items: [
      "marketing.capabilities.gear.item1",
      "marketing.capabilities.gear.item2",
      "marketing.capabilities.gear.item3",
      "marketing.capabilities.gear.item4",
      "marketing.capabilities.gear.item5",
      "marketing.capabilities.gear.item6",
      "marketing.capabilities.gear.item7",
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
      "marketing.capabilities.money.item7",
      "marketing.capabilities.money.item8",
      "marketing.capabilities.money.item9",
      "marketing.capabilities.money.item10",
      "marketing.capabilities.money.item11",
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
      "marketing.capabilities.shop.item9",
      "marketing.capabilities.shop.item10",
      "marketing.capabilities.shop.item11",
      "marketing.capabilities.shop.item12",
      "marketing.capabilities.shop.item13",
    ],
  },
  {
    // Added in the 2026-09-01 consolidation. Messages used to be scattered
    // across the other groups as half-lines ("readable email delivery history")
    // or missing outright (reminders, the night-before brief, WhatsApp, the
    // recap). A buyer comparing against an incumbent's "communications" tab
    // needs them in one place.
    title: "marketing.capabilities.reach.title",
    items: [
      "marketing.capabilities.reach.item1",
      "marketing.capabilities.reach.item2",
      "marketing.capabilities.reach.item3",
      "marketing.capabilities.reach.item4",
      "marketing.capabilities.reach.item5",
      "marketing.capabilities.reach.item6",
      "marketing.capabilities.reach.item7",
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
      "marketing.capabilities.records.item7",
      "marketing.capabilities.records.item8",
      "marketing.capabilities.records.item9",
      "marketing.capabilities.records.item10",
      "marketing.capabilities.records.item11",
    ],
  },
] as const;
