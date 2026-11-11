import type { DiverMessageKey } from "@/i18n/messages";
import type { ImportScopeRowId } from "./import";

/**
 * Published switching guides: an outcome to try, an honest fit comparison and
 * a source-backed export or explicitly qualified sample-review path.
 * The current claim review is docs/product/switching-review-20261111.md.
 * Copy lives in every locale's content/marketing.json; this registry contains
 * bundle keys, ordering and primary-source URLs only.
 *
 * IMPORT_HONESTY_TABLE describes importer support, never guaranteed source
 * coverage. Operators obtain their own files; we never request competitor
 * credentials or reach into their account.
 */

export type ExportStep = {
  /** Short imperative label for the step. */
  title: DiverMessageKey;
  /** One or two sentences of detail, in the shop owner's language. */
  detail: DiverMessageKey;
};

/** Manual coexistence for booking channels. State what the operator keeps,
 * what staff must do in both systems, and the direct-booking alternative. */
export type CoexistFraming = {
  /** Section heading naming the coexistence choice. */
  heading: DiverMessageKey;
  /** One or two sentences setting up the division of labor. */
  intro: DiverMessageKey;
  /**
   * Concede the incumbent's real strength (its distribution network / checkout)
   * and state the honest no-live-sync caveat: the CSV export below is the bridge.
   */
  bridgeNote: DiverMessageKey;
  /**
   * The alternative path: drop the channel entirely and take the booking in
   * DiveDay. It makes no price comparison; the linked pricing page owns the current offer.
   */
  replace?: { heading: DiverMessageKey; body: DiverMessageKey };
};

/** A trial, a booking/balance review and a handover selected after seeing the work. */
export type CutoverSection = {
  heading: DiverMessageKey;
  intro: DiverMessageKey;
  steps: { title: DiverMessageKey; detail: DiverMessageKey }[];
};

/**
 * The website ledger, for an incumbent whose real footprint is on the shop's
 * own site: every button, frame and link the shop pasted from it, beside the
 * DiveDay embed that replaces it (ADR 20260901-diveday-reimagined, decisions
 * 2 and 3). Today only FareHarbor carries one.
 *
 * Booking components are not a website transfer. Website work is a discussion,
 * never an included build or a quoted price.
 */
/**
 * The fragment of a guide's website ledger, so a link from inside the app (the
 * Settings embed page's "Switching from FareHarbor?") lands on the ledger
 * itself rather than the top of a long guide (Aaron, 2026-10-03).
 */
export const WEBSITE_LEDGER_ID = "website-ledger";

export type WebsiteFraming = {
  heading: DiverMessageKey;
  intro: DiverMessageKey;
  /**
   * One row per thing the shop pasted from the incumbent: their name for it,
   * our twin. In `theirs`, a proprietary name (Lightframe, Flows, Sites) stays
   * as the incumbent spells it in every locale and a generic noun (calendar,
   * QR codes) translates — deliberate, not a half-done pass. In `ours`, the
   * noun repeats only where it is a *rename* (Lightframe → Lightbox); where the
   * left cell already says it, the right cell carries only the difference.
   */
  ledger: { theirs: DiverMessageKey; ours: DiverMessageKey }[];
  /** Hosting and ownership need separate review when replacing booking components. */
  sitesNote: DiverMessageKey;
  /** Invitation to discuss website work, never an included build. */
  offer: { heading: DiverMessageKey; body: DiverMessageKey };
};

export type MigrationGuide = {
  /** URL segment: /switching/<slug>. */
  slug: string;
  /** The incumbent's name as shops know it — a proper name, rendered as-is. */
  competitor: string;
  /** One-line description used on the hub card. */
  cardSummary: DiverMessageKey;

  // Page metadata (SEO — these pages capture "leaving <incumbent>" searches).
  metaTitle: DiverMessageKey;
  metaDescription: DiverMessageKey;

  // Hero.
  heroEyebrow: DiverMessageKey;
  heroTitle: DiverMessageKey;
  heroLede: DiverMessageKey;

  /** Honest framing of the incumbent — paragraphs, no marketing puffery. */
  context: DiverMessageKey[];

  /**
   * Optional coexist framing, for a booking/distribution channel a shop can
   * keep rather than a records system to leave (today: FareHarbor, Peek Pro, Rezdy).
   * Rendered as a section above the export steps; absent for the leave-it guides.
   */
  coexist?: CoexistFraming;

  /**
   * Optional website ledger — what the shop pasted from the incumbent and the
   * DiveDay embed for each, plus the hosted-website comparison and the
   * website discussion. Rendered under the coexist section; today FareHarbor
   * only, whose storefront product is what a dive shop's site is built on.
   */
  website?: WebsiteFraming;

  // Source-backed export instructions or an explicitly qualified review plan.
  exportHeading: DiverMessageKey;
  exportIntro: DiverMessageKey;
  exportSteps: ExportStep[];
  /** Caveats that keep the click-path honest (version drift, what won't export). */
  exportNotes: DiverMessageKey[];

  /** What the switch itself looks like — every guide shares CUTOVER_SECTION. */
  cutover: CutoverSection;

  /**
   * Optional one-line, competitor-specific caveat for the import step — e.g. a
   * system that exports certs as a separate file, or one that holds no cards at
   * all. The import walkthrough itself is identical for every guide (it's one
   * importer); this is the single place a guide tailors it honestly.
   */
  importerNote?: DiverMessageKey;

  /**
   * Primary sources for the competitor claims on the page — the same references
   * recorded in competitive-strategy.md. The marketing claims policy
   * (docs/product/marketing.md) requires switching guides to cite incumbent
   * facts, so a shop can verify a volatile export path or a competitive claim
   * rather than take our word for it. Rendered as a "Sources" list on the guide.
   * Labels are the cited documents' own titles — never translated.
   */
  sources: { label: string; url: string }[];
};

/**
 * The diver-bundle words for {@link IMPORT_HONESTY_TABLE}'s rows
 * (src/lib/import.ts), one entry per row id. Every switching page — the
 * incumbent guides and /switching/spreadsheet — renders the table through this
 * one map, so the scope statement stays verbatim-identical across guides; the
 * staff importer renders the same rows through its own staff-bundle map
 * (src/app/shop/[shopSlug]/settings/import), per the one-bundle-per-surface
 * rule.
 */
export const IMPORT_SCOPE_ROW_KEYS: Record<
  ImportScopeRowId,
  { what: DiverMessageKey; detail: DiverMessageKey }
> = {
  contact: {
    what: "marketing.guides.shared.scopeTable.contact.what",
    detail: "marketing.guides.shared.scopeTable.contact.detail",
  },
  emergencyContact: {
    what: "marketing.guides.shared.scopeTable.emergencyContact.what",
    detail: "marketing.guides.shared.scopeTable.emergencyContact.detail",
  },
  diveInsurance: {
    what: "marketing.guides.shared.scopeTable.diveInsurance.what",
    detail: "marketing.guides.shared.scopeTable.diveInsurance.detail",
  },
  rentalSizes: {
    what: "marketing.guides.shared.scopeTable.rentalSizes.what",
    detail: "marketing.guides.shared.scopeTable.rentalSizes.detail",
  },
  certificationCard: {
    what: "marketing.guides.shared.scopeTable.certificationCard.what",
    detail: "marketing.guides.shared.scopeTable.certificationCard.detail",
  },
  specialtyCards: {
    what: "marketing.guides.shared.scopeTable.specialtyCards.what",
    detail: "marketing.guides.shared.scopeTable.specialtyCards.detail",
  },
  nitrox: {
    what: "marketing.guides.shared.scopeTable.nitrox.what",
    detail: "marketing.guides.shared.scopeTable.nitrox.detail",
  },
  signedWaivers: {
    what: "marketing.guides.shared.scopeTable.signedWaivers.what",
    detail: "marketing.guides.shared.scopeTable.signedWaivers.detail",
  },
  waiverDocuments: {
    what: "marketing.guides.shared.scopeTable.waiverDocuments.what",
    detail: "marketing.guides.shared.scopeTable.waiverDocuments.detail",
  },
  role: {
    what: "marketing.guides.shared.scopeTable.role.what",
    detail: "marketing.guides.shared.scopeTable.role.detail",
  },
  cardOnFile: {
    what: "marketing.guides.shared.scopeTable.cardOnFile.what",
    detail: "marketing.guides.shared.scopeTable.cardOnFile.detail",
  },
  pastVisits: {
    what: "marketing.guides.shared.scopeTable.pastVisits.what",
    detail: "marketing.guides.shared.scopeTable.pastVisits.detail",
  },
  paymentHistory: {
    what: "marketing.guides.shared.scopeTable.paymentHistory.what",
    detail: "marketing.guides.shared.scopeTable.paymentHistory.detail",
  },
  serviceHistory: {
    what: "marketing.guides.shared.scopeTable.serviceHistory.what",
    detail: "marketing.guides.shared.scopeTable.serviceHistory.detail",
  },
  diverNotes: {
    what: "marketing.guides.shared.scopeTable.diverNotes.what",
    detail: "marketing.guides.shared.scopeTable.diverNotes.detail",
  },
};

/**
 * Shared by every guide (see `CutoverSection` above). The bundle text is
 * verified against the importer's actual behavior, not aspirational: the
 * re-import claim matches `findOrCreatePerson`'s email-match update-in-place
 * (src/features/import/store.ts) and `priorVisitDedupeKey`'s idempotent history key
 * (src/lib/import.ts).
 *
 * `crewFirst` leads, and is deliberately not called `step5` even though it is
 * the fifth step this section grew (the 2026-08-27 conversion review, "help
 * arrives before the homework"). It answers the question an owner asks before
 * any of the others — what does my crew have to learn — and its own words place
 * it: "before you move a single record". Read fifth, after four steps about
 * moving records, it would contradict itself; read first, it is the review's
 * whole diagnosis applied to the section that carries it. The key is named for
 * what it says rather than where it sits so the next step added here does not
 * have to renumber four others in two locales.
 */
const CUTOVER_SECTION: CutoverSection = {
  heading: "marketing.guides.shared.cutover.heading",
  intro: "marketing.guides.shared.cutover.intro",
  steps: [
    {
      title: "marketing.guides.shared.cutover.crewFirst.title",
      detail: "marketing.guides.shared.cutover.crewFirst.detail",
    },
    {
      title: "marketing.guides.shared.cutover.step1.title",
      detail: "marketing.guides.shared.cutover.step1.detail",
    },
    {
      title: "marketing.guides.shared.cutover.step2.title",
      detail: "marketing.guides.shared.cutover.step2.detail",
    },
    {
      title: "marketing.guides.shared.cutover.step3.title",
      detail: "marketing.guides.shared.cutover.step3.detail",
    },
    {
      title: "marketing.guides.shared.cutover.step4.title",
      detail: "marketing.guides.shared.cutover.step4.detail",
    },
  ],
};

const eve: MigrationGuide = {
  slug: "eve",
  // i18n-exempt: competitor product name, rendered as-is in every locale
  competitor: "EVE",
  cardSummary: "marketing.guides.eve.cardSummary",

  metaTitle: "marketing.guides.eve.metaTitle",
  metaDescription: "marketing.guides.eve.metaDescription",

  heroEyebrow: "marketing.guides.eve.heroEyebrow",
  heroTitle: "marketing.guides.eve.heroTitle",
  heroLede: "marketing.guides.eve.heroLede",

  context: [
    "marketing.guides.eve.context.item1",
    "marketing.guides.eve.context.item2",
    "marketing.guides.eve.context.item3",
  ],

  exportHeading: "marketing.guides.eve.exportHeading",
  exportIntro: "marketing.guides.eve.exportIntro",
  exportSteps: [
    {
      title: "marketing.guides.eve.exportSteps.step1.title",
      detail: "marketing.guides.eve.exportSteps.step1.detail",
    },
    {
      title: "marketing.guides.eve.exportSteps.step2.title",
      detail: "marketing.guides.eve.exportSteps.step2.detail",
    },
    {
      title: "marketing.guides.eve.exportSteps.step3.title",
      detail: "marketing.guides.eve.exportSteps.step3.detail",
    },
    {
      title: "marketing.guides.eve.exportSteps.step4.title",
      detail: "marketing.guides.eve.exportSteps.step4.detail",
    },
  ],
  exportNotes: [
    "marketing.guides.eve.exportNotes.note1",
    "marketing.guides.eve.exportNotes.note2",
    "marketing.guides.eve.exportNotes.note3",
  ],
  cutover: CUTOVER_SECTION,
  sources: [
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "EVE sales module",
      url: "https://evediving.com/page/sales_module",
    },
    {
      // i18n-exempt: cited source title
      label: "EVE courses module",
      url: "https://evediving.com/page/courses_module",
    },
  ],
};

const diveshop360: MigrationGuide = {
  slug: "diveshop360",
  // i18n-exempt: competitor product name, rendered as-is in every locale
  competitor: "DiveShop360",
  cardSummary: "marketing.guides.diveshop360.cardSummary",

  metaTitle: "marketing.guides.diveshop360.metaTitle",
  metaDescription: "marketing.guides.diveshop360.metaDescription",

  heroEyebrow: "marketing.guides.diveshop360.heroEyebrow",
  heroTitle: "marketing.guides.diveshop360.heroTitle",
  heroLede: "marketing.guides.diveshop360.heroLede",

  context: [
    "marketing.guides.diveshop360.context.item1",
    "marketing.guides.diveshop360.context.item2",
    "marketing.guides.diveshop360.context.item3",
  ],

  exportHeading: "marketing.guides.diveshop360.exportHeading",
  exportIntro: "marketing.guides.diveshop360.exportIntro",
  exportSteps: [
    {
      title: "marketing.guides.diveshop360.exportSteps.step1.title",
      detail: "marketing.guides.diveshop360.exportSteps.step1.detail",
    },
    {
      title: "marketing.guides.diveshop360.exportSteps.step2.title",
      detail: "marketing.guides.diveshop360.exportSteps.step2.detail",
    },
    {
      title: "marketing.guides.diveshop360.exportSteps.step3.title",
      detail: "marketing.guides.diveshop360.exportSteps.step3.detail",
    },
    {
      title: "marketing.guides.diveshop360.exportSteps.step4.title",
      detail: "marketing.guides.diveshop360.exportSteps.step4.detail",
    },
  ],
  exportNotes: [
    "marketing.guides.diveshop360.exportNotes.note1",
    "marketing.guides.diveshop360.exportNotes.note2",
    "marketing.guides.diveshop360.exportNotes.note3",
  ],
  importerNote: "marketing.guides.diveshop360.importerNote",
  cutover: CUTOVER_SECTION,
  sources: [
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "DiveShop360 FAQ — the datasets you can export",
      url: "https://diveshop360.com/faq",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "DiveShop360 integrations",
      url: "https://diveshop360.com/integrations",
    },
  ],
};

const smartwaiver: MigrationGuide = {
  slug: "smartwaiver",
  // i18n-exempt: competitor product name, rendered as-is in every locale
  competitor: "Smartwaiver",
  cardSummary: "marketing.guides.smartwaiver.cardSummary",

  metaTitle: "marketing.guides.smartwaiver.metaTitle",
  metaDescription: "marketing.guides.smartwaiver.metaDescription",

  heroEyebrow: "marketing.guides.smartwaiver.heroEyebrow",
  heroTitle: "marketing.guides.smartwaiver.heroTitle",
  heroLede: "marketing.guides.smartwaiver.heroLede",

  context: [
    "marketing.guides.smartwaiver.context.item1",
    "marketing.guides.smartwaiver.context.item2",
    "marketing.guides.smartwaiver.context.item3",
    "marketing.guides.smartwaiver.context.item4",
  ],

  exportHeading: "marketing.guides.smartwaiver.exportHeading",
  exportIntro: "marketing.guides.smartwaiver.exportIntro",
  exportSteps: [
    {
      title: "marketing.guides.smartwaiver.exportSteps.step1.title",
      detail: "marketing.guides.smartwaiver.exportSteps.step1.detail",
    },
    {
      title: "marketing.guides.smartwaiver.exportSteps.step2.title",
      detail: "marketing.guides.smartwaiver.exportSteps.step2.detail",
    },
    {
      title: "marketing.guides.smartwaiver.exportSteps.step3.title",
      detail: "marketing.guides.smartwaiver.exportSteps.step3.detail",
    },
    {
      title: "marketing.guides.smartwaiver.exportSteps.step4.title",
      detail: "marketing.guides.smartwaiver.exportSteps.step4.detail",
    },
  ],
  exportNotes: [
    "marketing.guides.smartwaiver.exportNotes.note1",
    "marketing.guides.smartwaiver.exportNotes.note2",
    "marketing.guides.smartwaiver.exportNotes.note3",
  ],
  importerNote: "marketing.guides.smartwaiver.importerNote",
  cutover: CUTOVER_SECTION,
  sources: [
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "Smartwaiver participant CSV export",
      url: "https://support.smartwaiver.com/hc/en-us/articles/360056592012-How-do-I-export-my-completed-waiver-data",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "Smartwaiver signed PDF downloads",
      url: "https://support.smartwaiver.com/hc/en-us/articles/360057047891-Can-I-download-copies-of-my-signed-waivers-as-PDFs",
    },
  ],
};

const fareharbor: MigrationGuide = {
  slug: "fareharbor",
  // i18n-exempt: competitor product name, rendered as-is in every locale
  competitor: "FareHarbor",
  cardSummary: "marketing.guides.fareharbor.cardSummary",

  metaTitle: "marketing.guides.fareharbor.metaTitle",
  metaDescription: "marketing.guides.fareharbor.metaDescription",

  heroEyebrow: "marketing.guides.fareharbor.heroEyebrow",
  heroTitle: "marketing.guides.fareharbor.heroTitle",
  heroLede: "marketing.guides.fareharbor.heroLede",

  // Three paragraphs, not four: the fourth ("so there are two honest ways
  // DiveDay fits a FareHarbor shop…") announced the section immediately below
  // it, whose own heading and leave-path box say it better and say it twice.
  context: [
    "marketing.guides.fareharbor.context.item1",
    "marketing.guides.fareharbor.context.item2",
    "marketing.guides.fareharbor.context.item3",
  ],

  coexist: {
    heading: "marketing.guides.fareharbor.coexist.heading",
    intro: "marketing.guides.fareharbor.coexist.intro",
    bridgeNote: "marketing.guides.fareharbor.coexist.bridgeNote",
    replace: {
      heading: "marketing.guides.fareharbor.coexist.replaceHeading",
      body: "marketing.guides.fareharbor.coexist.replaceBody",
    },
  },

  website: {
    heading: "marketing.guides.fareharbor.website.heading",
    intro: "marketing.guides.fareharbor.website.intro",
    ledger: (["row1", "row2", "row3", "row4", "row5", "row6", "row7", "row8", "row9"] as const).map(
      (row) => ({
        theirs: `marketing.guides.fareharbor.website.rows.${row}.theirs` as const,
        ours: `marketing.guides.fareharbor.website.rows.${row}.ours` as const,
      }),
    ),
    sitesNote: "marketing.guides.fareharbor.website.sitesNote",
    // i18n-exempt: currency figure — FareHarbor's hosted-website rate as third parties report it (the Bókun source below), never restated in a bundle
    offer: {
      heading: "marketing.guides.fareharbor.website.offerHeading",
      body: "marketing.guides.fareharbor.website.offerBody",
    },
  },

  exportHeading: "marketing.guides.fareharbor.exportHeading",
  exportIntro: "marketing.guides.fareharbor.exportIntro",
  exportSteps: [
    {
      title: "marketing.guides.fareharbor.exportSteps.step1.title",
      detail: "marketing.guides.fareharbor.exportSteps.step1.detail",
    },
    {
      title: "marketing.guides.fareharbor.exportSteps.step2.title",
      detail: "marketing.guides.fareharbor.exportSteps.step2.detail",
    },
    {
      title: "marketing.guides.fareharbor.exportSteps.step3.title",
      detail: "marketing.guides.fareharbor.exportSteps.step3.detail",
    },
    {
      title: "marketing.guides.fareharbor.exportSteps.step4.title",
      detail: "marketing.guides.fareharbor.exportSteps.step4.detail",
    },
    {
      title: "marketing.guides.fareharbor.exportSteps.step5.title",
      detail: "marketing.guides.fareharbor.exportSteps.step5.detail",
    },
  ],
  exportNotes: [
    "marketing.guides.fareharbor.exportNotes.note1",
    "marketing.guides.fareharbor.exportNotes.note2",
    "marketing.guides.fareharbor.exportNotes.note3",
    "marketing.guides.fareharbor.exportNotes.note4",
  ],
  importerNote: "marketing.guides.fareharbor.importerNote",
  cutover: {
    heading: "marketing.guides.fareharbor.cutover.heading",
    intro: "marketing.guides.fareharbor.cutover.intro",
    steps: [
      {
        title: "marketing.guides.shared.cutover.crewFirst.title",
        detail: "marketing.guides.shared.cutover.crewFirst.detail",
      },
      {
        title: "marketing.guides.fareharbor.cutover.prepare.title",
        detail: "marketing.guides.fareharbor.cutover.prepare.detail",
      },
      {
        title: "marketing.guides.fareharbor.cutover.reconcile.title",
        detail: "marketing.guides.fareharbor.cutover.reconcile.detail",
      },
      {
        title: "marketing.guides.fareharbor.cutover.timing.title",
        detail: "marketing.guides.fareharbor.cutover.timing.detail",
      },
    ],
  },
  sources: [
    {
      // i18n-exempt: cited source title
      label: "FareHarbor Contacts report and download",
      url: "https://help.fareharbor.com/hc/en-us/articles/40898088413595-Contacts-report",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "FareHarbor — booking software for tours & activities",
      url: "https://fareharbor.com/",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "Booking Holdings acquires FareHarbor (2018)",
      url: "https://www.bookingholdings.com/press-releases/booking-holdings-announces-it-has-signed-an-agreement-to-acquire-fareharbor/",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "FareHarbor Distribution Network — for operators",
      url: "https://fareharbor.com/scale/distribution-network/operators/",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "FareHarbor Help — downloading a manifest or report as CSV",
      url: "https://help.fareharbor.com/hc/en-us/articles/40897898334619-How-do-I-download-a-manifest-or-report",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "FareHarbor provider terms",
      url: "https://fareharbor.com/legal/tos-providers/",
    },
  ],
};

const rezdy: MigrationGuide = {
  slug: "rezdy",
  // i18n-exempt: competitor product name, rendered as-is in every locale
  competitor: "Rezdy",
  cardSummary: "marketing.guides.rezdy.cardSummary",

  metaTitle: "marketing.guides.rezdy.metaTitle",
  metaDescription: "marketing.guides.rezdy.metaDescription",

  heroEyebrow: "marketing.guides.rezdy.heroEyebrow",
  heroTitle: "marketing.guides.rezdy.heroTitle",
  heroLede: "marketing.guides.rezdy.heroLede",

  // Three paragraphs — same cut as FareHarbor's, for the same reason.
  context: [
    "marketing.guides.rezdy.context.item1",
    "marketing.guides.rezdy.context.item2",
    "marketing.guides.rezdy.context.item3",
  ],

  coexist: {
    heading: "marketing.guides.rezdy.coexist.heading",
    intro: "marketing.guides.rezdy.coexist.intro",
    bridgeNote: "marketing.guides.rezdy.coexist.bridgeNote",
    replace: {
      heading: "marketing.guides.rezdy.coexist.replaceHeading",
      body: "marketing.guides.rezdy.coexist.replaceBody",
    },
  },

  exportHeading: "marketing.guides.rezdy.exportHeading",
  exportIntro: "marketing.guides.rezdy.exportIntro",
  exportSteps: [
    {
      title: "marketing.guides.rezdy.exportSteps.step1.title",
      detail: "marketing.guides.rezdy.exportSteps.step1.detail",
    },
    {
      title: "marketing.guides.rezdy.exportSteps.step2.title",
      detail: "marketing.guides.rezdy.exportSteps.step2.detail",
    },
    {
      title: "marketing.guides.rezdy.exportSteps.step3.title",
      detail: "marketing.guides.rezdy.exportSteps.step3.detail",
    },
    {
      title: "marketing.guides.rezdy.exportSteps.step4.title",
      detail: "marketing.guides.rezdy.exportSteps.step4.detail",
    },
    {
      title: "marketing.guides.rezdy.exportSteps.step5.title",
      detail: "marketing.guides.rezdy.exportSteps.step5.detail",
    },
  ],
  exportNotes: [
    "marketing.guides.rezdy.exportNotes.note1",
    "marketing.guides.rezdy.exportNotes.note2",
    "marketing.guides.rezdy.exportNotes.note3",
    "marketing.guides.rezdy.exportNotes.note4",
  ],
  importerNote: "marketing.guides.rezdy.importerNote",
  cutover: CUTOVER_SECTION,
  sources: [
    {
      // i18n-exempt: cited source title
      label: "Rezdy customers and main booking contacts",
      url: "https://support.rezdy.com/hc/en-us/articles/19867758531612-Customers-Mutual-Guests",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "Rezdy — booking software for tours & activities",
      url: "https://rezdy.com/booking-software/",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "Rezdy Channel Manager — the reseller marketplace",
      url: "https://rezdy.com/channel-manager/",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "Rezdy pricing — subscription plus a per-booking fee",
      url: "https://rezdy.com/pricing/",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "Rezdy Help — the Sales / Orders report and its CSV export",
      url: "https://support.rezdy.com/hc/en-us/articles/19867797356316-How-To-Use-the-Sales-Orders-Report",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "Rezdy developer docs — the operator-accessible API",
      url: "https://developers.rezdy.com/",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "Rezdy, Checkfront & Regiondo join one group (2023)",
      url: "https://rezdy.com/blog/rezdy-checkfront-regiondo/",
    },
  ],
};

/**
 * Every guide in this registry is a real, published page — there are no
 * roadmap or "coming soon" entries (marketing claims policy in
 * docs/product/marketing.md is shipped-only). A future incumbent gets an entry
 * here, and a route, once its claims are verified, or its export uncertainty is explicit.
 *
 * Most entries are a straight leave-it migration; the booking-channel guides
 * (FareHarbor, Peek Pro, Rezdy) additionally carry a `coexist` block, because a channel is
 * something a shop can keep and run DiveDay alongside, not a records system to
 * leave — see CoexistFraming above.
 *
 * **Order is by how many shops are actually on the thing**, not by when the
 * guide was written. FareHarbor leads: it is the incumbent a dive shop is most
 * likely to already be running, and the switching hub's own first card is the
 * spreadsheet — which is what everyone else is on. Those two answer the great
 * majority of arrivals, so they are the first two cards on the page rather than
 * the fourth and the first. The records-system guides keep their relative order
 * below them.
 */
const peek: MigrationGuide = {
  slug: "peek",
  // i18n-exempt: competitor product name
  competitor: "Peek Pro",
  cardSummary: "marketing.guides.peek.cardSummary",
  metaTitle: "marketing.guides.peek.metaTitle",
  metaDescription: "marketing.guides.peek.metaDescription",
  heroEyebrow: "marketing.guides.peek.heroEyebrow",
  heroTitle: "marketing.guides.peek.heroTitle",
  heroLede: "marketing.guides.peek.heroLede",
  exportHeading: "marketing.guides.peek.exportHeading",
  exportIntro: "marketing.guides.peek.exportIntro",
  importerNote: "marketing.guides.peek.importerNote",
  context: [
    "marketing.guides.peek.context.item1",
    "marketing.guides.peek.context.item2",
    "marketing.guides.peek.context.item3",
  ],
  coexist: {
    heading: "marketing.guides.peek.coexist.heading",
    intro: "marketing.guides.peek.coexist.intro",
    bridgeNote: "marketing.guides.peek.coexist.bridgeNote",
    replace: {
      heading: "marketing.guides.peek.coexist.replaceHeading",
      body: "marketing.guides.peek.coexist.replaceBody",
    },
  },
  exportSteps: [
    {
      title: "marketing.guides.peek.exportSteps.step1.title",
      detail: "marketing.guides.peek.exportSteps.step1.detail",
    },
    {
      title: "marketing.guides.peek.exportSteps.step2.title",
      detail: "marketing.guides.peek.exportSteps.step2.detail",
    },
    {
      title: "marketing.guides.peek.exportSteps.step3.title",
      detail: "marketing.guides.peek.exportSteps.step3.detail",
    },
    {
      title: "marketing.guides.peek.exportSteps.step4.title",
      detail: "marketing.guides.peek.exportSteps.step4.detail",
    },
  ],
  exportNotes: [
    "marketing.guides.peek.exportNotes.note1",
    "marketing.guides.peek.exportNotes.note2",
  ],
  cutover: CUTOVER_SECTION,
  sources: [
    {
      // i18n-exempt: cited source title
      label: "Peek Pro rentals, waivers and resource management",
      url: "https://www.peekpro.com/rentals",
    },
    {
      // i18n-exempt: cited source title
      label: "Peek Pro booking and revenue features",
      url: "https://www.peekpro.com/product/grow-revenue",
    },
    {
      // i18n-exempt: cited source title
      label: "Peek customer portal and operator settings",
      url: "https://support.peek.com/hc/en-us/articles/29197460170388-Using-Your-Customer-Portal",
    },
  ],
};

export const MIGRATION_GUIDES: MigrationGuide[] = [
  fareharbor,
  peek,
  eve,
  diveshop360,
  smartwaiver,
  rezdy,
];

/** Slugs with a page — the source for generateStaticParams and route validity. */
export const MIGRATION_GUIDE_SLUGS: string[] = MIGRATION_GUIDES.map((guide) => guide.slug);

/** Look up a guide by slug; an unknown slug returns null (→ 404). */
export function getMigrationGuide(slug: string): MigrationGuide | null {
  return MIGRATION_GUIDES.find((entry) => entry.slug === slug) ?? null;
}
