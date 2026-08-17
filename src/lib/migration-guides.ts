import type { DiverMessageKey } from "@/i18n/messages";
import type { ImportScopeRowId } from "./import";

/**
 * Public migration guides — the marketing surface of the portability wedge
 * (docs/product/assessments/competitive-strategy.md #3). One page per incumbent:
 * "Switching from EVE", "…from DiveShop360", and so on. Each guide is the same
 * three-part promise made concrete for that system — the exact steps to export
 * your own data from it, the scope table stating what does and doesn't come
 * across, and how DiveDay reads the file back in.
 *
 * This file holds structure only — slugs, ordering, section shapes, source
 * URLs — as message-bundle *keys*, never words, following the same
 * keys-not-copy pattern as `src/lib/marketing.ts` (ADR
 * 20260731-domain-layer-copy-leaks). The prose itself lives in
 * `src/i18n/locales/<locale>/diver.json` under `marketing.guides.*`
 * (`marketing.guides.shared.*` for the sections every guide shares,
 * `marketing.guides.<slug>.*` for each incumbent) — edit every locale
 * together. The switching pages resolve these keys through the negotiated
 * request locale's `diverTranslator`.
 *
 * The scope table is not restated here: every guide shows IMPORT_HONESTY_TABLE
 * from src/lib/import.ts verbatim (its rows resolved through
 * {@link IMPORT_SCOPE_ROW_KEYS}), because the honest answer to "what comes
 * across" is a property of the importer, not of the incumbent — and pinning it
 * to that one source keeps the marketing promise and the running code in step.
 *
 * Legal guardrail (competitive-strategy.md): a shop migrates from files it
 * exports itself. These guides only ever describe the incumbent's own export;
 * they never tell anyone to hand DiveDay a competitor's login, and DiveDay never
 * reaches into another system (Facebook v. Power Ventures).
 *
 * Content honesty (AGENTS.md): the click-paths are best-effort against desktop
 * software whose menus differ by version and that we cannot drive from here, so
 * each guide says where labels vary and points to the vendor's own support as
 * the authoritative path rather than inventing exact wording we can't stand
 * behind.
 */

export type ExportStep = {
  /** Short imperative label for the step. */
  title: DiverMessageKey;
  /** One or two sentences of detail, in the shop owner's language. */
  detail: DiverMessageKey;
};

/**
 * Optional "works alongside" framing, for an incumbent that is a booking and
 * distribution *channel* rather than a records system to leave outright (today:
 * FareHarbor and Rezdy — general tours-and-activities booking engines a dive
 * shop bolts a storefront onto). It is the same "bring your POS, we run the
 * water" division of labor the product page already draws, extended to a booking
 * channel: keep the incumbent for the storefront it's genuinely good at, run the
 * dive day it was never built for in DiveDay.
 *
 * Honesty guardrails baked into the shape (marketing.md): there is no
 * integration between DiveDay and any such channel, so `bridgeNote` must state
 * plainly that the CSV import below is the only bridge — never imply a live
 * sync. `runsInDiveDay` items are shipped-only, demonstrable in the live demo.
 * When this field is absent a guide is a straight leave-it migration like the
 * records-system guides. Candidates for the next channel guides are surveyed in
 * docs/product/assessments/switching-guide-landscape.md.
 */
export type CoexistFraming = {
  /** Section heading — coexist-led, the day the incumbent can't run. */
  heading: DiverMessageKey;
  /** One or two sentences setting up the division of labor. */
  intro: DiverMessageKey;
  /**
   * The dive-day jobs DiveDay runs that a booking engine has no concept of.
   * Shared keys ({@link COEXIST_RUNS_IN_DIVEDAY}); two of the messages
   * interpolate `{competitor}`, so render them with the guide's competitor
   * name as a value.
   */
  runsInDiveDay: { title: DiverMessageKey; detail: DiverMessageKey }[];
  /**
   * Concede the incumbent's real strength (its distribution network / checkout)
   * and state the honest no-live-sync caveat: the CSV export below is the bridge.
   */
  bridgeNote: DiverMessageKey;
  /** The alternative path: drop the channel entirely and take the booking in DiveDay. */
  replace: { heading: DiverMessageKey; body: DiverMessageKey };
};

/**
 * The "what does the actual switch look like" section every guide answers the
 * same way — parallel-run, timing, re-import safety, and a rough time
 * estimate are properties of the importer and the switch itself, not of any
 * one incumbent, so this is one shared object every guide points at (like
 * `COEXIST_RUNS_IN_DIVEDAY` below).
 */
export type CutoverSection = {
  heading: DiverMessageKey;
  intro: DiverMessageKey;
  steps: { title: DiverMessageKey; detail: DiverMessageKey }[];
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
   * keep rather than a records system to leave (today: FareHarbor, Rezdy).
   * Rendered as a section above the export steps; absent for the leave-it guides.
   */
  coexist?: CoexistFraming;

  // The export click-path: how to get the data out of the incumbent's system.
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
 * Shared body for the two booking-channel guides' `coexist.runsInDiveDay` list
 * (FareHarbor, Rezdy). Four of the six messages name no incumbent at all; the
 * other two (item1, item5) interpolate `{competitor}` — the bundle is the one
 * place that text is authored, so the guides can't drift apart line by line.
 * Render these with `{ competitor: guide.competitor }` as values.
 */
const COEXIST_RUNS_IN_DIVEDAY: { title: DiverMessageKey; detail: DiverMessageKey }[] = [
  {
    title: "marketing.guides.shared.coexist.item1.title",
    detail: "marketing.guides.shared.coexist.item1.detail",
  },
  {
    title: "marketing.guides.shared.coexist.item2.title",
    detail: "marketing.guides.shared.coexist.item2.detail",
  },
  {
    title: "marketing.guides.shared.coexist.item3.title",
    detail: "marketing.guides.shared.coexist.item3.detail",
  },
  {
    title: "marketing.guides.shared.coexist.item4.title",
    detail: "marketing.guides.shared.coexist.item4.detail",
  },
  {
    title: "marketing.guides.shared.coexist.item5.title",
    detail: "marketing.guides.shared.coexist.item5.detail",
  },
  {
    title: "marketing.guides.shared.coexist.item6.title",
    detail: "marketing.guides.shared.coexist.item6.detail",
  },
];

/**
 * Shared by every guide (see `CutoverSection` above). The bundle text is
 * verified against the importer's actual behavior, not aspirational: the
 * re-import claim matches `findOrCreatePerson`'s email-match update-in-place
 * (src/db/import.ts) and `priorVisitDedupeKey`'s idempotent history key
 * (src/lib/import.ts).
 */
const CUTOVER_SECTION: CutoverSection = {
  heading: "marketing.guides.shared.cutover.heading",
  intro: "marketing.guides.shared.cutover.intro",
  steps: [
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
    {
      title: "marketing.guides.eve.exportSteps.step5.title",
      detail: "marketing.guides.eve.exportSteps.step5.detail",
    },
    {
      title: "marketing.guides.eve.exportSteps.step6.title",
      detail: "marketing.guides.eve.exportSteps.step6.detail",
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
      label: "DiveShop360 acquires EVE Diving (Divernet, 2023)",
      url: "https://divernet.com/scuba-news/dive-shop-360-acquires-eve-diving/",
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
    {
      title: "marketing.guides.diveshop360.exportSteps.step5.title",
      detail: "marketing.guides.diveshop360.exportSteps.step5.detail",
    },
    {
      title: "marketing.guides.diveshop360.exportSteps.step6.title",
      detail: "marketing.guides.diveshop360.exportSteps.step6.detail",
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
      label: "Smartwaiver",
      url: "https://www.smartwaiver.com/",
    },
    {
      // i18n-exempt: cited source title — the document's own name is not translated
      label: "DiveShop360 integrations — Smartwaiver waivers",
      url: "https://diveshop360.com/integrations",
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
    runsInDiveDay: COEXIST_RUNS_IN_DIVEDAY,
    bridgeNote: "marketing.guides.fareharbor.coexist.bridgeNote",
    replace: {
      heading: "marketing.guides.fareharbor.coexist.replaceHeading",
      body: "marketing.guides.fareharbor.coexist.replaceBody",
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
  cutover: CUTOVER_SECTION,
  sources: [
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
      label: "FareHarbor's per-booking fee model, explained (TrekkSoft, third-party)",
      url: "https://www.trekksoft.com/en/blog/fareharbor-pricing-guide-what-to-know-before-you-buy",
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
    runsInDiveDay: COEXIST_RUNS_IN_DIVEDAY,
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
      url: "https://support.rezdy.com/hc/en-us/articles/203690794-How-To-Use-the-Sales-Orders-Report",
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
 * here, and a route, only once its export click-path is real.
 *
 * Most entries are a straight leave-it migration; the booking-channel guides
 * (FareHarbor, Rezdy) additionally carry a `coexist` block, because a channel is
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
export const MIGRATION_GUIDES: MigrationGuide[] = [
  fareharbor,
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
