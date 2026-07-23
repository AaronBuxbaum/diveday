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
  /** URL segment: /switching/<slug>. */
  slug: string;
  /** The incumbent's name as shops know it. */
  competitor: string;
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

  /**
   * Optional one-line, competitor-specific caveat for the import step — e.g. a
   * system that exports certs as a separate file, or one that holds no cards at
   * all. The import walkthrough itself is identical for every guide (it's one
   * importer); this is the single place a guide tailors it honestly.
   */
  importerNote?: string;

  /**
   * Primary sources for the competitor claims on the page — the same references
   * recorded in competitive-strategy.md. The marketing claims policy
   * (docs/product/marketing.md) requires switching guides to cite incumbent
   * facts, so a shop can verify a volatile export path or a competitive claim
   * rather than take our word for it. Rendered as a "Sources" list on the guide.
   */
  sources: { label: string; url: string }[];
};

const eve: MigrationGuide = {
  slug: "eve",
  competitor: "EVE",
  cardSummary:
    "Long the Windows desktop shop-management system for PADI retailers, now owned by DiveShop360. Export your customers and cards, then bring them here.",

  metaTitle: "Switching from EVE to DiveDay",
  metaDescription:
    "Leaving EVE? A step-by-step guide to exporting your customers and certifications from EVE and bringing them into DiveDay — what comes across, what doesn't, and why.",

  heroEyebrow: "Switching to DiveDay",
  heroTitle: "Moving your shop off EVE",
  heroLede:
    "EVE keeps your divers and their cards on a Windows PC in the back office. Here's how to get that data out of EVE yourself and bring your people, cards, and rental sizes into DiveDay — with a plain account of what makes the trip and what stays behind.",

  context: [
    "EVE (from Integrated Scuba Systems) is the desktop shop-management system PADI retailers ran for years, and DiveShop360 acquired it in 2023. If you're planning a move off it, this guide is about the practical part: getting your people and their cards out of EVE and into DiveDay.",
    "The part that makes leaving feel risky is real: EVE stores its data in a database on your own PC, and shops report that years of purchase and service history are hard to pull out cleanly. DiveDay's import is deliberately not trying to move all of that. It moves the thing you actually need on day one — your roster, their certification cards, and their rental sizes — so your people are in hand for your first trips, every card waiting as a claim your staff verify, and the history stays where it already is.",
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
    "Do this while your EVE install still opens and your license is active — a working export today beats chasing it later.",
    "Your column headings don't have to match anything. DiveDay recognizes the common names EVE and every other system use, and shows you exactly how each column mapped before you commit.",
    "Purchase and service history isn't part of this move, and that's by design — see the scope table below. It stays in your EVE records; DiveDay starts your people clean and ready.",
  ],
  sources: [
    {
      label: "DiveShop360 acquires EVE Diving (Divernet, 2023)",
      url: "https://divernet.com/scuba-news/dive-shop-360-acquires-eve-diving/",
    },
  ],
};

const diveshop360: MigrationGuide = {
  slug: "diveshop360",
  competitor: "DiveShop360",
  cardSummary:
    "The retail-POS incumbent. Export the customer and certification CSVs its own FAQ names, then bring your people across.",

  metaTitle: "Switching from DiveShop360 to DiveDay",
  metaDescription:
    "Leaving DiveShop360? A step-by-step guide to exporting your customers and certification data as CSV and bringing them into DiveDay — what comes across, what doesn't, and why.",

  heroEyebrow: "Switching to DiveDay",
  heroTitle: "Moving your shop off DiveShop360",
  heroLede:
    "DiveShop360 keeps your customers and their cards in the cloud, and its own help pages name the datasets you can export as CSV. Here's how to pull your people and certifications and bring them into DiveDay — with a plain account of what makes the trip and what stays behind.",

  context: [
    "DiveShop360 grew out of a retail point-of-sale system, and that's where it's strongest — registers, inventory, vendor catalogs. Its own FAQ names four things you can export to CSV: customers, inventory, sales reports, and certification data. For a move to DiveDay you need two of them — customers and certification data. The other two are retail records DiveDay isn't trying to be a home for.",
    "We're not here to replace your point of sale. DiveDay runs the water — bookings, readiness, the boat — so \"bring your POS, we run the dive day\" is a real division of labor, not a slogan. That's also why we only ask for the customer and certification files, not your whole retail history.",
    "One rule we won't bend: you export your own CSV from your own DiveShop360 account. DiveDay never signs into DiveShop360 and never reaches across to pull your data — that's your data to hand us, not ours to take.",
  ],

  exportHeading: "Get your data out of DiveShop360",
  exportIntro:
    "DiveShop360 runs in a browser, and exports come from the back-office admin, not the register. The goal is two CSVs — your customers and your certification data. DiveShop360 has no public API or bulk export, so this is a manual, dataset-by-dataset download; menu labels shift between versions, so treat these as the shape of the path.",
  exportSteps: [
    {
      title: "Sign into DiveShop360 admin as an owner or manager",
      detail:
        "Exports live in the back office, behind an owner or manager login — not the point-of-sale screen your front desk rings sales on.",
    },
    {
      title: "Find the customer export",
      detail:
        "Look under Customers or Reports for a CSV export of your customer list. DiveShop360's own FAQ lists customers as one of the four datasets you can export.",
    },
    {
      title: "Export all customers to CSV",
      detail:
        "Export the whole customer list, not a filtered or single-page view, so no one is left behind. Save the file where you'll find it.",
    },
    {
      title: "Export the certification data too",
      detail:
        "Certifications are a separate one of DiveShop360's four exportable datasets. Export it as CSV — it holds the agency, level, and card number, and the card number is what lets a card come across at all.",
    },
    {
      title: "Skip inventory and sales reports",
      detail:
        "Those are the other two exportable datasets. You don't need them for DiveDay — we're not your POS. Keep them for your own records.",
    },
    {
      title: "Stuck on an export? Ask DiveShop360 support",
      detail:
        "If a dataset won't export from the UI, their support can produce a customer or certification CSV. Ask in writing and keep the file — that file is all DiveDay needs.",
    },
  ],
  exportNotes: [
    "Manual CSV, dataset by dataset, is a limit of DiveShop360 — no API, no bulk export, no webhooks — not of DiveDay. Doing it yourself from the admin is the whole path.",
    "Your column headings don't have to match anything. DiveDay recognizes the common names DiveShop360 and every other system use, and shows you exactly how each column mapped before you commit.",
    "Retail history, repair tickets, and your e-commerce site aren't part of a contact import — see the scope table below. They stay in DiveShop360.",
  ],
  importerNote:
    "DiveShop360 exports customers and certification data as two separate files. Import the customer file first, then the certification file — DiveDay matches people by email, so the second file updates the same divers instead of duplicating them.",
  sources: [
    {
      label: "DiveShop360 FAQ — the datasets you can export",
      url: "https://diveshop360.com/faq",
    },
    { label: "DiveShop360 integrations", url: "https://diveshop360.com/integrations" },
  ],
};

const diveadmin: MigrationGuide = {
  slug: "diveadmin",
  competitor: "DiveAdmin",
  cardSummary:
    "The fast, cheap newcomer. Export your customer CSV — or use its Google Drive backup — and bring your roster across.",

  metaTitle: "Switching from DiveAdmin to DiveDay",
  metaDescription:
    "Leaving DiveAdmin? A step-by-step guide to exporting your customers and certifications and bringing them into DiveDay — what comes across, what doesn't, and why.",

  heroEyebrow: "Switching to DiveDay",
  heroTitle: "Moving your shop off DiveAdmin",
  heroLede:
    "DiveAdmin keeps your customers in the cloud, exportable as CSV, and can drop an automated backup into your own Google Drive. Here's how to pull your roster and cards and bring them into DiveDay — with a plain account of what makes the trip and what stays behind.",

  context: [
    "DiveAdmin is the newer, lower-priced option, and it leans hard on an open, API-forward story. Worth knowing before you plan a move: its documented API is built to take data in — leads and bookings — not to hand your records back in bulk. The route out is the customer CSV export, or the automated backup DiveAdmin can write to your own Google Drive.",
    "That's genuinely fine for this move. DiveDay's import needs your people, their certification cards, and their rental sizes — exactly what a customer export carries. You don't need an API to bring a spreadsheet.",
    "One rule we won't bend: you export your own file from your own DiveAdmin account (or your own Google Drive backup). DiveDay never signs into DiveAdmin and never reaches across to pull your data — that's your data to hand us, not ours to take.",
  ],

  exportHeading: "Get your data out of DiveAdmin",
  exportIntro:
    "DiveAdmin runs in a browser. The goal is a customer CSV with your people and their cards. Menu labels shift between versions, so treat these as the shape of the path, not word-for-word buttons.",
  exportSteps: [
    {
      title: "Sign into your DiveAdmin dashboard as an owner or admin",
      detail: "Exports live in the admin dashboard, behind an owner or manager login.",
    },
    {
      title: "Open your customers (or members) list",
      detail:
        "Find the area that lists every customer with their details. You want the full roster, not a single record.",
    },
    {
      title: "Export the list to CSV",
      detail:
        "DiveAdmin's customer lists export to a spreadsheet. Export everyone, and save the CSV where you'll find it.",
    },
    {
      title: "Include certifications",
      detail:
        "If cards (agency, level, card number) are columns on the customer export, you're set. If they're a separate export, pull that too — the card number is what lets a card come across.",
    },
    {
      title: "No dashboard export? Use your Google Drive backup",
      detail:
        "DiveAdmin can write automated backups to your own Google Drive. The customer CSV inside that backup works just as well as a manual export — it's still your file.",
    },
  ],
  exportNotes: [
    "DiveAdmin's API ingests data; it doesn't hand your records back in bulk. The CSV export (or the Google Drive backup) is the route out, not the API.",
    "Your column headings don't have to match anything. DiveDay recognizes the common names DiveAdmin and every other system use, and shows you exactly how each column mapped before you commit.",
    "Booking and message history isn't part of a contact import — see the scope table below. It stays in DiveAdmin.",
  ],
  importerNote:
    'If your certifications export as free text ("PADI Advanced Open Water"), DiveDay recognizes the common levels and lands each as a claim your staff verify; anything it doesn\'t recognize is flagged in the preview for a person to enter by hand.',
  sources: [
    {
      label: "DiveAdmin API documentation",
      url: "https://diveadmin.com/en/api-documentation",
    },
    {
      label: "DiveAdmin — automated Google Drive backups",
      url: "https://diveadmin.com/resources/dive-admin-vs-eve/",
    },
  ],
};

const smartwaiver: MigrationGuide = {
  slug: "smartwaiver",
  competitor: "Smartwaiver",
  cardSummary:
    "Waivers only. Export your participant CSV and bring the people across — waivers are re-signed here, natively.",

  metaTitle: "Switching from Smartwaiver to DiveDay",
  metaDescription:
    "Moving off Smartwaiver? A step-by-step guide to exporting your participants and bringing them into DiveDay's native waivers — what comes across, what doesn't, and why.",

  heroEyebrow: "Switching to DiveDay",
  heroTitle: "Moving your waivers off Smartwaiver",
  heroLede:
    "Smartwaiver holds signed waivers and the people who signed them, exportable as a participant CSV. Here's how to bring those people into DiveDay — where waivers are native, versioned, and re-signed against your own template — with a plain account of what makes the trip and what stays behind.",

  context: [
    "Smartwaiver does one thing — digital waivers — and some shops reach it because their booking system (DiveShop360 among them) outsources waivers to it. DiveDay's waivers are native and built into every tier, so moving off Smartwaiver means two things: bring the people across, and re-sign the waiver itself in DiveDay.",
    "The people migrate cleanly: a Smartwaiver participant export carries names, email, phone, and often an emergency contact — the roster you need. What it doesn't hold is certification cards or rental sizes; a waiver system isn't where those live, so expect the import to be mostly contact data.",
    "The waiver itself is re-signed here, not imported, and that's deliberate. A signed Smartwaiver PDF is evidence tied to Smartwaiver's template and Smartwaiver's questions; it isn't a satisfied DiveDay waiver. Your divers sign your DiveDay waiver once, and medical answers are collected fresh — a cleared flag from another system is never clearance here. The scope table below states this plainly.",
    "One rule we won't bend: you export your own participant CSV from your own Smartwaiver account. DiveDay never signs into Smartwaiver and never reaches across to pull your data — that's your data to hand us, not ours to take.",
  ],

  exportHeading: "Get your data out of Smartwaiver",
  exportIntro:
    "Smartwaiver runs in a browser. The goal is a participant CSV — the people who signed your waivers. Menu labels shift over time, so treat these as the shape of the path, not word-for-word buttons.",
  exportSteps: [
    {
      title: "Sign into your Smartwaiver dashboard",
      detail: "Exports live in the dashboard, behind your account login.",
    },
    {
      title: "Open the waiver or participant search",
      detail:
        "Find the area that lists the people who have signed — usually a waivers or participants search with an export option.",
    },
    {
      title: "Set the date range wide, then export to CSV",
      detail:
        "Set the range as broad as it goes — all time — so every participant is included, then export the list to CSV and save it where you'll find it.",
    },
    {
      title: "That CSV is your roster",
      detail:
        "Names, email, phone, and any emergency contact you collected are what come across. That's the people; the waiver itself is re-signed in DiveDay.",
    },
  ],
  exportNotes: [
    "Smartwaiver holds waivers, not certification cards or gear sizes — so mostly it's the people who migrate, and that's the roster you need.",
    "Your column headings don't have to match anything. DiveDay recognizes the common names Smartwaiver and every other system use, and shows you exactly how each column mapped before you commit.",
    "Signed waivers and their medical answers aren't imported — see the scope table below. Your divers re-sign your DiveDay waiver, and health answers are collected fresh.",
  ],
  importerNote:
    "A Smartwaiver export is contact data — expect people and emergency contacts to import, and no certification cards or rental sizes (a waiver system doesn't hold them). The waivers themselves are re-signed in DiveDay against your own template.",
  sources: [
    { label: "Smartwaiver", url: "https://www.smartwaiver.com/" },
    {
      label: "DiveShop360 integrations — Smartwaiver waivers",
      url: "https://diveshop360.com/integrations",
    },
  ],
};

/**
 * Every guide in this registry is a real, published page — there are no
 * roadmap or "coming soon" entries (marketing claims policy in
 * docs/product/marketing.md is shipped-only). A future incumbent gets an entry
 * here, and a route, only once its export click-path is real.
 */
export const MIGRATION_GUIDES: MigrationGuide[] = [eve, diveshop360, diveadmin, smartwaiver];

/** Slugs with a page — the source for generateStaticParams and route validity. */
export const MIGRATION_GUIDE_SLUGS: string[] = MIGRATION_GUIDES.map((guide) => guide.slug);

/** Look up a guide by slug; an unknown slug returns null (→ 404). */
export function getMigrationGuide(slug: string): MigrationGuide | null {
  return MIGRATION_GUIDES.find((entry) => entry.slug === slug) ?? null;
}
