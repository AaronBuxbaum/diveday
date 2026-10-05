import type { DiverMessageKey } from "@/i18n/messages";
import type { FeaturePageKey } from "@/lib/feature-pages";
import { openGraphSite, sharedLinkCardImage } from "@/lib/site-metadata";

/**
 * Public-facing product claims, as message-bundle *keys* — never words. The
 * homepage, product, and pricing pages resolve these through the request
 * locale's `diverTranslator`, so every claim renders in the visitor's own
 * language and the pages always describe the same product. Keep claims
 * constrained to workflows that are available in DiveDay today; the words
 * themselves live in `src/i18n/locales/<locale>/diver.json` under
 * `marketing.price`, `marketing.export`, and `marketing.capabilities` — edit
 * every locale together.
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
 * **Every marketing page spreads this, `/` included.** It used to be every
 * page *except* `/`, because the card was `src/app/opengraph-image.tsx` and
 * file-based image metadata is collected per segment, so Next re-attached it to
 * the root segment's own page for free. The card is now a route handler
 * (`src/app/link-card/route.tsx`, issue #1709) precisely so that it is attached
 * to nothing, which means `/` has to name it like every other page — a
 * page-level `openGraph` block replaces the root layout's rather than merging
 * into it.
 *
 * Setting it explicitly is safe either way — if a field would have been
 * inherited, restating it changes nothing.
 */
export const sharedLinkCard = {
  ...openGraphSite,
  images: [sharedLinkCardImage],
};

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
  // `item7` is the one service line among product lines: the storefront in the
  // shop's brand and the embeds are shipped, and the website built to order is
  // the second authorized service offer (H-64/H-65, docs/product/marketing.md)
  // — a person's commitment, priced inside the subscription until the owner
  // says otherwise, never a turnaround time or a page count.
  includedKeys: [
    "marketing.price.item1",
    "marketing.price.item2",
    "marketing.price.item3",
    "marketing.price.item4",
    "marketing.price.item6",
    "marketing.price.item7",
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

/**
 * A group of the index: one per feature page, keyed by the page's own key
 * (`src/lib/feature-pages.ts`), plus three that belong to no single page —
 * the diver record, running the shop, and the records a shop takes with it.
 */
export type CapabilityGroupId = FeaturePageKey | "divers" | "shop" | "records";

export interface CapabilityAreaKeys {
  id: CapabilityGroupId;
  /**
   * A feature page's group is titled with the page's own name
   * (`marketing.featurePages.<key>.name`), so the index and the page it links
   * to can never call the same job two things.
   */
  title: DiverMessageKey;
  items: readonly DiverMessageKey[];
}

/**
 * The whole shipped surface, by the job it does — the reference list on
 * `/product` for a buyer who has read the story and now wants the list, and
 * the "What’s in it" checklist on each feature page.
 *
 * Every line is a workflow shipped today (docs/product/marketing.md,
 * shipped-only). When a slice ships, it belongs here as well as in
 * docs/product/shipped.md; when a claim here stops being true, it comes out.
 * Deliberately plain: this is the list people scan with a competitor's page
 * open beside it, and it earns nothing by being written like the bands above
 * it.
 *
 * **It is the full inventory, not a highlight reel.** Until 2026-09-01 this
 * held 49 lines in seven groups — one chosen line per area, which read as
 * precise and left a buyer with the incumbent's feature page open counting
 * what was missing. The bar for a line is that it is walkable in the product,
 * in the buyer's words; the bar for *leaving one out* is that it is not a
 * thing a shop would ever look for. One thing is never listed twice.
 *
 * **Grouped by feature page since 2026-10-05** (H-93). The nine groups it had
 * were the product's own areas ("The dive day", "Reaching divers"), which is
 * how the code is organised and not how a shop asks; each feature page now
 * renders its own group as its checklist, so a line lives under the page a
 * buyer would look for it on. The same rework checked every line against the
 * code and corrected the ones that had drifted: a diver cancels a booking but
 * cannot move it, the courtesy text is SMS, a cancelled departure refunds by
 * itself only when weather or a short head count cancelled it, and the inbox
 * hears replies to email.
 */
export const productCapabilityIndex: readonly CapabilityAreaKeys[] = [
  {
    id: "onlineBooking",
    title: "marketing.featurePages.onlineBooking.name",
    items: [
      "marketing.capabilities.onlineBooking.item1",
      "marketing.capabilities.onlineBooking.item2",
      "marketing.capabilities.onlineBooking.item3",
      "marketing.capabilities.onlineBooking.item4",
      "marketing.capabilities.onlineBooking.item5",
      "marketing.capabilities.onlineBooking.item6",
      "marketing.capabilities.onlineBooking.item7",
      "marketing.capabilities.onlineBooking.item8",
      "marketing.capabilities.onlineBooking.item9",
    ],
  },
  {
    id: "website",
    title: "marketing.featurePages.website.name",
    items: [
      "marketing.capabilities.website.item1",
      "marketing.capabilities.website.item2",
      "marketing.capabilities.website.item3",
      "marketing.capabilities.website.item4",
      "marketing.capabilities.website.item5",
      "marketing.capabilities.website.item6",
      "marketing.capabilities.website.item7",
      "marketing.capabilities.website.item8",
      "marketing.capabilities.website.item9",
      "marketing.capabilities.website.item10",
      "marketing.capabilities.website.item11",
    ],
  },
  {
    id: "waivers",
    title: "marketing.featurePages.waivers.name",
    items: [
      "marketing.capabilities.waivers.item1",
      "marketing.capabilities.waivers.item2",
      "marketing.capabilities.waivers.item3",
      "marketing.capabilities.waivers.item4",
      "marketing.capabilities.waivers.item5",
      "marketing.capabilities.waivers.item6",
      "marketing.capabilities.waivers.item7",
      "marketing.capabilities.waivers.item8",
    ],
  },
  {
    id: "certifications",
    title: "marketing.featurePages.certifications.name",
    items: [
      "marketing.capabilities.certifications.item1",
      "marketing.capabilities.certifications.item2",
      "marketing.capabilities.certifications.item3",
      "marketing.capabilities.certifications.item4",
      "marketing.capabilities.certifications.item5",
      "marketing.capabilities.certifications.item6",
      "marketing.capabilities.certifications.item7",
      "marketing.capabilities.certifications.item8",
    ],
  },
  {
    id: "messages",
    title: "marketing.featurePages.messages.name",
    items: [
      "marketing.capabilities.messages.item1",
      "marketing.capabilities.messages.item2",
      "marketing.capabilities.messages.item3",
      "marketing.capabilities.messages.item4",
      "marketing.capabilities.messages.item5",
      "marketing.capabilities.messages.item6",
      "marketing.capabilities.messages.item7",
      "marketing.capabilities.messages.item8",
    ],
  },
  {
    id: "checkIn",
    title: "marketing.featurePages.checkIn.name",
    items: [
      "marketing.capabilities.checkIn.item1",
      "marketing.capabilities.checkIn.item2",
      "marketing.capabilities.checkIn.item3",
      "marketing.capabilities.checkIn.item4",
      "marketing.capabilities.checkIn.item5",
      "marketing.capabilities.checkIn.item6",
      "marketing.capabilities.checkIn.item7",
      "marketing.capabilities.checkIn.item8",
    ],
  },
  {
    id: "boatManifest",
    title: "marketing.featurePages.boatManifest.name",
    items: [
      "marketing.capabilities.boatManifest.item1",
      "marketing.capabilities.boatManifest.item2",
      "marketing.capabilities.boatManifest.item3",
      "marketing.capabilities.boatManifest.item4",
      "marketing.capabilities.boatManifest.item5",
      "marketing.capabilities.boatManifest.item6",
      "marketing.capabilities.boatManifest.item7",
      "marketing.capabilities.boatManifest.item8",
      "marketing.capabilities.boatManifest.item9",
      "marketing.capabilities.boatManifest.item10",
    ],
  },
  {
    id: "diveSites",
    title: "marketing.featurePages.diveSites.name",
    items: [
      "marketing.capabilities.diveSites.item1",
      "marketing.capabilities.diveSites.item2",
      "marketing.capabilities.diveSites.item3",
      "marketing.capabilities.diveSites.item4",
      "marketing.capabilities.diveSites.item5",
      "marketing.capabilities.diveSites.item6",
      "marketing.capabilities.diveSites.item7",
      "marketing.capabilities.diveSites.item8",
      "marketing.capabilities.diveSites.item9",
    ],
  },
  {
    id: "rentalGear",
    title: "marketing.featurePages.rentalGear.name",
    items: [
      "marketing.capabilities.rentalGear.item1",
      "marketing.capabilities.rentalGear.item2",
      "marketing.capabilities.rentalGear.item3",
      "marketing.capabilities.rentalGear.item4",
      "marketing.capabilities.rentalGear.item5",
      "marketing.capabilities.rentalGear.item6",
      "marketing.capabilities.rentalGear.item7",
      "marketing.capabilities.rentalGear.item8",
      "marketing.capabilities.rentalGear.item9",
      "marketing.capabilities.rentalGear.item10",
      "marketing.capabilities.rentalGear.item11",
      "marketing.capabilities.rentalGear.item12",
    ],
  },
  {
    id: "schedule",
    title: "marketing.featurePages.schedule.name",
    items: [
      "marketing.capabilities.schedule.item1",
      "marketing.capabilities.schedule.item2",
      "marketing.capabilities.schedule.item3",
      "marketing.capabilities.schedule.item4",
      "marketing.capabilities.schedule.item5",
      "marketing.capabilities.schedule.item6",
      "marketing.capabilities.schedule.item7",
      "marketing.capabilities.schedule.item8",
      "marketing.capabilities.schedule.item9",
      "marketing.capabilities.schedule.item10",
      "marketing.capabilities.schedule.item11",
      "marketing.capabilities.schedule.item12",
    ],
  },
  {
    id: "courses",
    title: "marketing.featurePages.courses.name",
    items: [
      "marketing.capabilities.courses.item1",
      "marketing.capabilities.courses.item2",
      "marketing.capabilities.courses.item3",
      "marketing.capabilities.courses.item4",
      "marketing.capabilities.courses.item5",
      "marketing.capabilities.courses.item6",
      "marketing.capabilities.courses.item7",
    ],
  },
  {
    id: "payments",
    title: "marketing.featurePages.payments.name",
    items: [
      "marketing.capabilities.payments.item1",
      "marketing.capabilities.payments.item2",
      "marketing.capabilities.payments.item3",
      "marketing.capabilities.payments.item4",
      "marketing.capabilities.payments.item5",
      "marketing.capabilities.payments.item6",
      "marketing.capabilities.payments.item7",
      "marketing.capabilities.payments.item8",
      "marketing.capabilities.payments.item9",
      "marketing.capabilities.payments.item10",
      "marketing.capabilities.payments.item11",
    ],
  },
  {
    id: "divers",
    title: "marketing.capabilities.divers.title",
    items: [
      "marketing.capabilities.divers.item1",
      "marketing.capabilities.divers.item2",
      "marketing.capabilities.divers.item3",
      "marketing.capabilities.divers.item4",
      "marketing.capabilities.divers.item5",
    ],
  },
  {
    id: "shop",
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
    ],
  },
  {
    id: "records",
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
    ],
  },
] as const;

const CAPABILITY_GROUPS = new Map<CapabilityGroupId, CapabilityAreaKeys>(
  productCapabilityIndex.map((group) => [group.id, group]),
);

/** One group of the index, by its id; a feature page reads its own this way. */
export function capabilityGroup(id: CapabilityGroupId): CapabilityAreaKeys {
  const group = CAPABILITY_GROUPS.get(id);
  if (!group) throw new Error(`no capability group: ${id}`);
  return group;
}
