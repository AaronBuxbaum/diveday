/**
 * Public migration guides — the marketing surface of the portability wedge
 * (docs/product/assessments/competitive-strategy.md #3). One page per incumbent:
 * "Switching from EVE", "…from DiveShop360", and so on. Each guide is the same
 * three-part promise made concrete for that system — the exact steps to export
 * your own data from it, the scope table stating what does and doesn't come
 * across, and how DiveDay reads the file back in.
 *
 * The scope table is not restated here: every guide shows IMPORT_HONESTY_TABLE
 * from src/lib/import.ts verbatim, because the honest answer to "what comes
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
  title: string;
  /** One or two sentences of detail, in the shop owner's language. */
  detail: string;
};

export type MigrationGuide = {
  /** URL segment: /switch/<slug>. */
  slug: string;
  /** The incumbent's name as shops know it. */
  competitor: string;
  /** "live" guides have a page; "planned" render as a coming-soon card on the hub. */
  status: "live" | "planned";
  /** One-line description used on the hub card. */
  cardSummary: string;

  // Page metadata (SEO — these pages capture "leaving <incumbent>" searches).
  metaTitle: string;
  metaDescription: string;

  // Hero.
  heroEyebrow: string;
  heroTitle: string;
  heroLede: string;

  /** Honest framing of the incumbent — paragraphs, no marketing puffery. */
  context: string[];

  // The export click-path: how to get the data out of the incumbent's system.
  exportHeading: string;
  exportIntro: string;
  exportSteps: ExportStep[];
  /** Caveats that keep the click-path honest (version drift, what won't export). */
  exportNotes: string[];
};

const eve: MigrationGuide = {
  slug: "eve",
  competitor: "EVE",
  status: "live",
  cardSummary:
    "The PADI-endorsed Windows desktop CRM, now owned by DiveShop360. Export your customers and cards, then bring them here.",

  metaTitle: "Switching from EVE to DiveDay",
  metaDescription:
    "Leaving EVE? A step-by-step guide to exporting your customers and certifications from EVE and bringing them into DiveDay — what comes across, what doesn't, and why.",

  heroEyebrow: "Switching to DiveDay",
  heroTitle: "Moving your shop off EVE",
  heroLede:
    "EVE keeps your divers and their cards on a Windows PC in the back office. Here's how to get that data out of EVE yourself and bring your people, cards, and rental sizes into DiveDay — with a plain account of what makes the trip and what stays behind.",

  context: [
    "EVE (from Integrated Scuba Systems) is the desktop shop-management system PADI retailers ran for years. DiveShop360 acquired it in 2023, and shops on it are widely planning their move — so if you're reading this, you're likely deciding where to land, not whether to leave.",
    "The part that makes leaving feel risky is real: EVE stores its data in a database on your own PC, and shops report that years of purchase and service history are hard to pull out cleanly. DiveDay's import is deliberately not trying to move all of that. It moves the thing you actually need on day one — your roster, their certification cards, and their rental sizes — so your first trips out of the gate are safe and staffed, and the history stays where it already is.",
    "One rule we won't bend: you export your own file from your own EVE install. DiveDay never logs into EVE and never reaches across to another system to pull your data — that's your data to hand us, not ours to take.",
  ],

  exportHeading: "Get your data out of EVE",
  exportIntro:
    "EVE runs on Windows, so this happens on the back-office PC where EVE is installed — not on a website. The goal is a spreadsheet of your customers and their certification cards. Exact menu labels shifted across EVE versions, so treat these as the shape of the path, not word-for-word buttons.",
  exportSteps: [
    {
      title: "Open EVE on the shop PC and sign in with a manager account",
      detail:
        "Reporting and exports live in the back office, behind a manager or owner login — not the point-of-sale till. Use the PC where EVE actually holds its database.",
    },
    {
      title: "Open the customer list or a customer/certification report",
      detail:
        "Find the area that lists every customer with their certification details — usually under a Customers or Reports menu. You want the full roster, not a single record.",
    },
    {
      title: "Widen the range to all customers, all time",
      detail:
        "If the list or report asks for a date range or an active-only filter, set it as broad as it goes so recent-only or lapsed customers aren't quietly left out.",
    },
    {
      title: "Export to Excel or CSV and save it",
      detail:
        "EVE's lists and reports export to a spreadsheet — choose CSV if it's offered, or export to Excel and use File → Save As → CSV. Save it somewhere you'll find it, like the desktop.",
    },
    {
      title: "Do the same for certifications if they're a separate report",
      detail:
        "If cards (agency, level, card number) live in their own report rather than on the customer list, export that too. A card number is what lets DiveDay bring a card across at all.",
    },
    {
      title: "Can't reach the export? Ask EVE's current owner",
      detail:
        "If your license has lapsed or the export is greyed out, DiveShop360 now owns EVE and can produce a customer and certification export for you. Ask in writing and keep the file — that file is all DiveDay needs.",
    },
  ],
  exportNotes: [
    "Do this while your EVE install still opens. A working export today beats chasing a sunset system later.",
    "Your column headings don't have to match anything. DiveDay recognizes the common names EVE and every other system use, and shows you exactly how each column mapped before you commit.",
    "Purchase and service history isn't part of this move, and that's by design — see the scope table below. It stays in your EVE records; DiveDay starts your people clean and ready.",
  ],
};

/**
 * The rest of the switching pool from competitive-strategy.md #3, ordered by the
 * strategy's priority. These render as coming-soon cards on the hub until each
 * one's page is written and flipped to "live".
 */
const planned: MigrationGuide[] = [
  {
    slug: "diveshop360",
    competitor: "DiveShop360",
    status: "planned",
    cardSummary:
      "The retail-POS incumbent. Export the four datasets its own FAQ names, then bring your people across.",
    metaTitle: "Switching from DiveShop360 to DiveDay",
    metaDescription:
      "Leaving DiveShop360? How to export your customers and certifications and bring them into DiveDay.",
    heroEyebrow: "Switching to DiveDay",
    heroTitle: "Moving your shop off DiveShop360",
    heroLede: "",
    context: [],
    exportHeading: "",
    exportIntro: "",
    exportSteps: [],
    exportNotes: [],
  },
  {
    slug: "diveadmin",
    competitor: "DiveAdmin",
    status: "planned",
    cardSummary:
      "The fast, cheap newcomer. Export your customer CSVs and bring your roster, cards, and sizes here.",
    metaTitle: "Switching from DiveAdmin to DiveDay",
    metaDescription:
      "Leaving DiveAdmin? How to export your customers and certifications and bring them into DiveDay.",
    heroEyebrow: "Switching to DiveDay",
    heroTitle: "Moving your shop off DiveAdmin",
    heroLede: "",
    context: [],
    exportHeading: "",
    exportIntro: "",
    exportSteps: [],
    exportNotes: [],
  },
  {
    slug: "smartwaiver",
    competitor: "Smartwaiver",
    status: "planned",
    cardSummary:
      "Waivers only. Export your participant CSV and bring the people across — waivers are re-signed here.",
    metaTitle: "Switching from Smartwaiver to DiveDay",
    metaDescription:
      "Moving off Smartwaiver? How to export your participants and bring them into DiveDay's native waivers.",
    heroEyebrow: "Switching to DiveDay",
    heroTitle: "Moving your waivers off Smartwaiver",
    heroLede: "",
    context: [],
    exportHeading: "",
    exportIntro: "",
    exportSteps: [],
    exportNotes: [],
  },
];

/** All guides, live first, in strategy-priority order. */
export const MIGRATION_GUIDES: MigrationGuide[] = [eve, ...planned];

/** Slugs with a real page — the source for generateStaticParams and route validity. */
export const LIVE_MIGRATION_GUIDE_SLUGS: string[] = MIGRATION_GUIDES.filter(
  (guide) => guide.status === "live",
).map((guide) => guide.slug);

/** Look up a live guide by slug; planned or unknown slugs return null (→ 404). */
export function getLiveMigrationGuide(slug: string): MigrationGuide | null {
  const guide = MIGRATION_GUIDES.find((entry) => entry.slug === slug);
  return guide && guide.status === "live" ? guide : null;
}
