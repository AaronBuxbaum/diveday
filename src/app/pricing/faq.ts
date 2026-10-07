import type { DiverTranslator } from "@/i18n/messages";
import { continuityPromise, fullShopExport } from "@/lib/marketing";
import { ONBOARDING_EMAIL, SUPPORT_EMAIL } from "@/lib/platform-mail";

export type PricingFaqRow = {
  question: string;
  answer: string;
  link?: { href: string; label: string };
};

/**
 * The /pricing FAQ rows, in order. Kept beside the page so the route file
 * stays under its page-length baseline; the page renders these and feeds
 * them to the FAQPage JSON-LD. `competitors` is the registry-derived list.
 */
export function pricingFaq(t: DiverTranslator, competitors: string): readonly PricingFaqRow[] {
  // "What is included?" left this list on 2026-08-13: the hero now answers it
  // in the first screenful, and a FAQ row restating the screen above it is the
  // duplication the three-densities rule exists to stop.
  // `link` is one optional pair, not two independent optional fields: a row
  // carrying an href with no label (or the reverse) would render no door at
  // all, silently and with nothing to typecheck against.
  return [
    {
      question: t("marketing.pricing.faq.billing.question"),
      answer: t("marketing.pricing.faq.billing.answer"),
    },
    {
      // The per-seat fear, answered where the flat price raises it: the
      // number above is per *location*, and the roles it covers are the six
      // in src/lib/authz.ts's STAFF_ROLES. Divers never authenticate at all —
      // they book on the public shop pages and reach their own trip through a
      // capability link, so a growing customer list is not a growing bill
      // either.
      question: t("marketing.pricing.faq.crewSize.question"),
      answer: t("marketing.pricing.faq.crewSize.answer"),
    },
    {
      question: t("marketing.pricing.faq.trialMeaning.question"),
      // The upgrade address, not the support one: marketing.md routes "how do
      // I move a trial shop to paid" through its own inbox, and the soft
      // expiry ("nothing switches off") restates src/lib/trial.ts, where
      // expiry blocks no route and no mutation.
      answer: t("marketing.pricing.faq.trialMeaning.answer", { email: ONBOARDING_EMAIL }),
    },
    {
      question: t("marketing.pricing.faq.seeBefore.question"),
      answer: t("marketing.pricing.faq.seeBefore.answer"),
    },
    {
      // Counted against what setup is now: one email to the onboarding
      // address, and a person creates the shop (its name, web address and
      // timezone) and the owner's login, because every shop is set up by
      // hand (ADR 20260925-shops-are-set-up-by-hand). Until 2026-10-05 this
      // answer still counted the six fields of a sign-up form no visitor can
      // reach. The spreadsheet is named as its own step because it is one —
      // but the importer's preview belongs to the `switching` row below, not
      // here: in the row-major two-column grid this row and that one used to
      // sit one above the other in the left column, and both closed on the
      // same eight-word promise about seeing what will happen before anything
      // is saved. This is the time question, so it ends on time.
      question: t("marketing.pricing.faq.setupTime.question"),
      answer: t("marketing.pricing.faq.setupTime.answer", { email: ONBOARDING_EMAIL }),
    },
    // "Does the manifest work offline?" left this list on 2026-08-28: a
    // product question wearing pricing clothes, and the boat manifest page
    // answers it at depth beside the screen it is about
    // (`marketing.featurePages.boatManifest`).
    // Nothing on this page decides on it (docs/product/marketing-review-20260827.md).
    {
      question: t("marketing.pricing.faq.dataIfNotWorking.question"),
      answer: t("marketing.pricing.faq.dataIfNotWorking.answer", {
        claim: t(fullShopExport.claimKey),
        terms: t(fullShopExport.termsKey),
      }),
    },
    {
      // The vendor-death objection, answered beside the export it rests on:
      // the shared continuity promise (`continuityPromise`), an authorized
      // service commitment whose words are the product owner's (H-101).
      question: t("marketing.pricing.faq.shutdown.question"),
      answer: t(continuityPromise.claimKey),
    },
    {
      question: t("marketing.pricing.faq.switching.question"),
      answer: t("marketing.pricing.faq.switching.answer", { competitors }),
      // The one row whose answer is a door as much as a sentence: the guides
      // it names live at /switching, and without this link the footer is the
      // only path to them from here.
      link: { href: "/switching", label: t("marketing.pricing.faq.switching.guidesLink") },
    },
    {
      question: t("marketing.pricing.faq.agency.question"),
      answer: t("marketing.pricing.faq.agency.answer"),
    },
    {
      question: t("marketing.pricing.faq.pos.question"),
      answer: t("marketing.pricing.faq.pos.answer"),
    },
    {
      question: t("marketing.pricing.faq.whyFounding.question"),
      answer: t("marketing.pricing.faq.whyFounding.answer"),
    },
    {
      question: t("marketing.pricing.faq.multipleLocations.question"),
      answer: t("marketing.pricing.faq.multipleLocations.answer", { email: SUPPORT_EMAIL }),
    },
  ];
}
