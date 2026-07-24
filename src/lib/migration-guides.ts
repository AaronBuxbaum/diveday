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
  heading: string;
  /** One or two sentences setting up the division of labor. */
  intro: string;
  /** The dive-day jobs DiveDay runs that a booking engine has no concept of. */
  runsInDiveDay: { title: string; detail: string }[];
  /**
   * Concede the incumbent's real strength (its distribution network / checkout)
   * and state the honest no-live-sync caveat: the CSV export below is the bridge.
   */
  bridgeNote: string;
  /** The alternative path: drop the channel entirely and take the booking in DiveDay. */
  replace: { heading: string; body: string };
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

  /**
   * Optional coexist framing, for a booking/distribution channel a shop can
   * keep rather than a records system to leave (today: FareHarbor, Rezdy).
   * Rendered as a section above the export steps; absent for the leave-it guides.
   */
  coexist?: CoexistFraming;

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
    "Export your participant CSV and bring the people across — a waiver your file already shows as signed comes in marked imported, so nobody has to sign twice.",

  metaTitle: "Switching from Smartwaiver to DiveDay",
  metaDescription:
    "Moving off Smartwaiver? A step-by-step guide to exporting your participants and bringing them, and their already-signed waivers, into DiveDay.",

  heroEyebrow: "Switching to DiveDay",
  heroTitle: "Moving your waivers off Smartwaiver",
  heroLede:
    "Smartwaiver holds signed waivers and the people who signed them, exportable as a participant CSV. Here's how to bring those people — and, when your file shows a waiver already accepted, that acceptance too — into DiveDay, where waivers are native and versioned against your own template going forward.",

  context: [
    "Smartwaiver does one thing — digital waivers — and some shops reach it because their booking system (DiveShop360 among them) outsources waivers to it. DiveDay's waivers are native and built into every tier, so moving off Smartwaiver means bringing the people across and telling DiveDay which of them already have a waiver on file.",
    "The people migrate cleanly: a Smartwaiver participant export carries names, email, phone, and often an emergency contact — the roster you need. What it doesn't hold is certification cards or rental sizes; a waiver system isn't where those live, so expect most of the file to be contact data.",
    "If a row in your export marks a diver's waiver as already accepted, DiveDay's importer trusts that and brings the waiver across too — marked imported, dated to the acceptance date in your file, and satisfying the boarding gate without asking the diver to sign again. It isn't a copy of the signed Smartwaiver PDF itself (that stays in Smartwaiver, or you can attach a saved copy of it during import); it's your prior acceptance, carried forward. The importer's preview shows exactly what will happen, row by row, before anything is saved. The scope table below states this plainly.",
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
        "Names, email, phone, and any emergency contact you collected are what come across, along with whichever column in your export shows a waiver as already signed — if it has one.",
    },
  ],
  exportNotes: [
    "Smartwaiver holds waivers, not certification cards or gear sizes — so mostly it's the people who migrate, and that's the roster you need.",
    "Your column headings don't have to match anything. DiveDay recognizes the common names Smartwaiver and every other system use, and shows you exactly how each column mapped before you commit.",
    "A diver your file shows as already signed comes across marked imported, not asked to sign again — see the scope table below for exactly what that does and doesn't carry over.",
  ],
  importerNote:
    "A Smartwaiver export is mostly contact data — expect people and emergency contacts to import, and no certification cards or rental sizes (a waiver system doesn't hold them). A waiver your export shows as already accepted comes across too, marked imported.",
  sources: [
    { label: "Smartwaiver", url: "https://www.smartwaiver.com/" },
    {
      label: "DiveShop360 integrations — Smartwaiver waivers",
      url: "https://diveshop360.com/integrations",
    },
  ],
};

const fareharbor: MigrationGuide = {
  slug: "fareharbor",
  competitor: "FareHarbor",
  cardSummary:
    "A booking engine for tours, not dive software. Keep its booking button and hotel/OTA network and run the dive day it can't — or leave the per-booking fee behind entirely. Either way, bring your divers across.",

  metaTitle: "FareHarbor and DiveDay — run the dive day, or switch",
  metaDescription:
    "On FareHarbor? Keep its booking and distribution network and run the dive day it was never built for — cert checks, waivers, and the roll-call manifest — or leave the per-booking fee behind. Bring your divers across, with an honest account of what comes with them.",

  heroEyebrow: "FareHarbor + DiveDay",
  heroTitle: "FareHarbor fills the seats. DiveDay runs the boat.",
  heroLede:
    "FareHarbor takes the online booking and puts you in front of its hotel and reseller network — and then the dive day still runs on a clipboard, because a general booking engine was never built for cards, waivers, or a roll call on the water. Here's how DiveDay runs that day: keep FareHarbor for the storefront, or leave the per-booking fee behind and take the booking here too. Either way, bringing your divers across is the same few minutes.",

  context: [
    "FareHarbor is an online booking platform for tours, activities, and rentals — owned by Booking Holdings, the company behind Booking.com — and plenty of dive shops run their storefront on it. It's genuinely good at that job: guests book and pay online, and its distribution network puts your trips in front of hotels, concierges, and resellers you'd never reach on your own. We're not here to talk you out of any of that.",
    "What it isn't is dive software. FareHarbor makes no claim to certification gating, medical waivers that fail closed, rental-gear fit, or a boat manifest built for a roll call — because it's a general booking engine, not a dive shop's back office. Its \"manifest\" is a passenger list you can download; it has no concept of a C-card. So your guests book beautifully, and then the part that keeps people safe on the water still runs on a clipboard.",
    "And the storefront isn't free: FareHarbor charges nothing monthly, but it takes a fee on every booking — added to your guest's checkout price — for as long as you use it. It doesn't publish the rate; you hear it on a sales call (third parties report around 6%). A cut of every booking, forever, is the thing a growing shop feels.",
    "So there are two honest ways DiveDay fits a FareHarbor shop, below: keep FareHarbor for the storefront and add the dive day it can't run, or take the booking in DiveDay too and leave the per-booking fee behind. Whichever you pick, you bring your divers across the same way — and the safety spine holds either way.",
  ],

  coexist: {
    heading: "Keep FareHarbor. Add the day it can't run.",
    intro:
      'DiveDay runs the water side — everything between "booked" and "back at the dock" that a booking engine was never built to touch. Point-for-point, this is what FareHarbor leaves to your clipboard:',
    runsInDiveDay: [
      {
        title: "Readiness that won't let an unready diver board",
        detail:
          "The trip and the dive site decide what each diver needs; if a card or waiver can't be verified, DiveDay says so plainly instead of passing them through. FareHarbor takes the booking — it never checks whether the diver is cleared to get on the boat.",
      },
      {
        title: "Certification checks that actually gate the dive",
        detail:
          "Every card is captured pending and verified by your staff, never trusted on sight; a deep dive won't clear a diver who isn't carded for it, and a nitrox request gets plain air until staff verify the card. A general booking engine has no concept of a C-card.",
      },
      {
        title: "Native waivers with medical review — in every tier",
        detail:
          "Waivers are built in and versioned against your own release, and a medical answer that calls for a physician's sign-off blocks the diver until that review — it doesn't just warn. Not a form stapled to a checkout, and not a paid add-on.",
      },
      {
        title: "A roll-call manifest that survives the dock",
        detail:
          "Big Boarded / Not-boarded buttons for wet thumbs, a head count for every dive, and a manifest the crew saves to the phone so it keeps working after the signal drops at the ramp.",
      },
      {
        title: "Rental fit and the trip's packing list",
        detail:
          "Every diver's sizes become the boat's kit list, with a tank per diver per dive split by air and nitrox. FareHarbor doesn't know a diver's wetsuit size.",
      },
      {
        title: "The night-before brief and a recap they share",
        detail:
          "Each diver gets a plain-language brief the night before — dock time, conditions, what to bring — and a shareable recap page after. The booking confirmation was the start; this is the rest of the relationship.",
      },
    ],
    bridgeNote:
      "FareHarbor keeps doing what it's good at — taking the online booking and putting you in front of its hotel and reseller network, which DiveDay has no equivalent for and won't pretend to. There's no wire between the two systems: you bring your divers into DiveDay with the CSV export below, and re-import as your roster grows. What you get back for that is the dive day itself.",
    replace: {
      heading: "Or leave the per-booking fee behind.",
      body: "If FareHarbor is really just your booking button — you're not leaning on its distribution network — you don't need to keep paying on every booking to keep it. DiveDay takes the booking itself: a public schedule anyone can book without an account, checkout through your own Stripe account, and the same native waivers. Bring your divers across once, point your booking link at DiveDay, and the per-booking fee stops. The steps below are the same either way.",
    },
  },

  exportHeading: "Get your data out of FareHarbor",
  exportIntro:
    "FareHarbor runs in a browser, and your data comes out of the Dashboard's reports — there's no single \"export everything\" button. The goal is your people as a CSV. Menu labels shift over time, so treat these as the shape of the path, not word-for-word buttons.",
  exportSteps: [
    {
      title: "Sign into your FareHarbor Dashboard as an owner or admin",
      detail:
        "Reports live in the Dashboard, behind an owner or admin login — not the guest-facing booking page.",
    },
    {
      title: "Open Reports and run the Contacts (customer) report",
      detail:
        "FareHarbor's Contacts report is your customer list — names, email, phone — for a date range. That roster is what you need; the rest of the reports are booking and sales records.",
    },
    {
      title: "Set the date range as wide as it goes",
      detail:
        "The Contacts report is scoped to a range, not a single all-time dump, so widen it as far as FareHarbor allows before you run it — otherwise a slow season or a lapsed regular quietly gets left behind.",
    },
    {
      title: "Download it as CSV",
      detail:
        "FareHarbor's reports and manifests download as CSV straight from the Dashboard. Save the file where you'll find it — that file is all DiveDay needs.",
    },
    {
      title: "Don't wait on the API",
      detail:
        "FareHarbor has an API, but access is partner-gated — you email their support to request it, and it's built for resellers, not a self-serve export you can run yourself. The Dashboard CSV is your route out, and it's enough.",
    },
  ],
  exportNotes: [
    'The Contacts report is date-scoped, not a one-click "everything" export — set the range as wide as FareHarbor allows so seasonal and lapsed customers come along.',
    "Your column headings don't have to match anything. DiveDay recognizes the common names FareHarbor and every other system use, and shows you exactly how each column mapped before you commit.",
    "Certification cards and rental sizes aren't in a FareHarbor export — a booking engine doesn't hold them (see the scope table below). Expect people and their contact details; certs and sizes you build in DiveDay as divers arrive.",
  ],
  importerNote:
    "A FareHarbor export is mostly contact data — expect people, emails, phones, and any emergency contact to import, and no certification cards or rental sizes (a booking platform doesn't hold them). Import the Contacts file; DiveDay matches divers by email, so a later re-import updates the same people instead of duplicating them.",
  sources: [
    {
      label: "FareHarbor — booking software for tours & activities",
      url: "https://fareharbor.com/",
    },
    {
      label: "Booking Holdings acquires FareHarbor (2018)",
      url: "https://www.bookingholdings.com/press-releases/booking-holdings-announces-it-has-signed-an-agreement-to-acquire-fareharbor/",
    },
    {
      label: "FareHarbor Distribution Network — for operators",
      url: "https://fareharbor.com/scale/distribution-network/operators/",
    },
    {
      label: "FareHarbor Help — downloading a manifest or report as CSV",
      url: "https://help.fareharbor.com/hc/en-us/articles/40897898334619-How-do-I-download-a-manifest-or-report",
    },
    {
      label: "FareHarbor's per-booking fee model, explained (TrekkSoft, third-party)",
      url: "https://www.trekksoft.com/en/blog/fareharbor-pricing-guide-what-to-know-before-you-buy",
    },
  ],
};

const rezdy: MigrationGuide = {
  slug: "rezdy",
  competitor: "Rezdy",
  cardSummary:
    "A general tours booking platform with a big reseller marketplace — not dive software. Keep it for distribution and run the dive day it can't, or leave the monthly fee plus per-booking cut behind. Either way, bring your divers across.",

  metaTitle: "Rezdy and DiveDay — run the dive day, or switch",
  metaDescription:
    "On Rezdy? Keep its reseller marketplace and run the dive day it was never built for — cert checks, waivers, and the roll-call manifest — or leave the monthly subscription and per-booking fee behind. Bring your divers across, with an honest account of what comes with them.",

  heroEyebrow: "Rezdy + DiveDay",
  heroTitle: "Rezdy sells the seats. DiveDay runs the boat.",
  heroLede:
    "Rezdy takes the online booking and pushes your trips out to its reseller marketplace and the big OTAs — and then the dive day still runs on a clipboard, because a general booking engine was never built for cards, waivers, or a roll call on the water. Here's how DiveDay runs that day: keep Rezdy for the storefront, or leave the monthly-fee-plus-per-booking-cut behind and take the booking here too. Either way, bringing your divers across is the same few minutes.",

  context: [
    "Rezdy is an online booking platform for tours, activities, and experiences — built in Australia, now part of a group with Checkfront and Regiondo under a private-equity-backed parent. Plenty of dive shops run their storefront on it, and it's genuinely good at that job: guests book and pay online, and its channel manager pushes your trips out to a marketplace of resellers and OTAs — GetYourGuide, Viator, Expedia, Google Things to Do — that you'd struggle to reach on your own. We're not here to talk you out of any of that.",
    "What it isn't is dive software. Rezdy publishes no certification gating, no dive-medical waivers, no boat manifest built for a roll call, and no rental-gear fit — because it's a general booking engine, not a dive shop's back office. Selling a course as a bookable product isn't the same as tracking whether the diver in front of you is actually carded for the dive. So your guests book beautifully, and then the part that keeps people safe on the water still runs on a clipboard.",
    "The storefront isn't free either: Rezdy charges a monthly subscription plus a cut of every online booking (3% on its current published pricing, with a no-monthly-fee option that still takes the 3%). To its credit, Rezdy doesn't lock you in — no setup fee, no contract, a self-serve CSV export, and an API you can turn on yourself. That's a fair way to treat your data, and it's exactly what makes running DiveDay alongside Rezdy — or moving off it entirely — a low-risk decision rather than a fight.",
    "So there are two honest ways DiveDay fits a Rezdy shop, below: keep Rezdy for the storefront and add the dive day it can't run, or take the booking in DiveDay too and leave the monthly fee and the per-booking cut behind. Whichever you pick, you bring your divers across the same way — and the safety spine holds either way.",
  ],

  coexist: {
    heading: "Keep Rezdy. Add the day it can't run.",
    intro:
      'DiveDay runs the water side — everything between "booked" and "back at the dock" that a booking engine was never built to touch. Point-for-point, this is what Rezdy leaves to your clipboard:',
    runsInDiveDay: [
      {
        title: "Readiness that won't let an unready diver board",
        detail:
          "The trip and the dive site decide what each diver needs; if a card or waiver can't be verified, DiveDay says so plainly instead of passing them through. Rezdy takes the booking — it never checks whether the diver is cleared to get on the boat.",
      },
      {
        title: "Certification checks that actually gate the dive",
        detail:
          "Every card is captured pending and verified by your staff, never trusted on sight; a deep dive won't clear a diver who isn't carded for it, and a nitrox request gets plain air until staff verify the card. A general booking engine has no concept of a C-card.",
      },
      {
        title: "Native waivers with medical review — in every tier",
        detail:
          "Waivers are built in and versioned against your own release, and a medical answer that calls for a physician's sign-off blocks the diver until that review — it doesn't just warn. Not a form stapled to a checkout, and not a paid add-on.",
      },
      {
        title: "A roll-call manifest that survives the dock",
        detail:
          "Big Boarded / Not-boarded buttons for wet thumbs, a head count for every dive, and a manifest the crew saves to the phone so it keeps working after the signal drops at the ramp.",
      },
      {
        title: "Rental fit and the trip's packing list",
        detail:
          "Every diver's sizes become the boat's kit list, with a tank per diver per dive split by air and nitrox. Rezdy doesn't know a diver's wetsuit size.",
      },
      {
        title: "The night-before brief and a recap they share",
        detail:
          "Each diver gets a plain-language brief the night before — dock time, conditions, what to bring — and a shareable recap page after. The booking confirmation was the start; this is the rest of the relationship.",
      },
    ],
    bridgeNote:
      "Rezdy keeps doing what it's good at — taking the online booking and pushing your trips to its reseller marketplace and the OTAs, which DiveDay has no equivalent for and won't pretend to. There's no wire between the two systems: you bring your divers into DiveDay with the CSV export below, and re-import as your roster grows. What you get back for that is the dive day itself.",
    replace: {
      heading: "Or leave the monthly fee and the per-booking cut behind.",
      body: "If you're not leaning on Rezdy's marketplace, you're paying a monthly subscription and a slice of every booking for a storefront you could run here. DiveDay takes the booking itself: a public schedule anyone can book without an account, checkout through your own Stripe account, and the same native waivers. And Rezdy makes this easy on you — no lock-in contract, a self-serve CSV export, an API you can turn on yourself — so bringing your divers across and pointing your booking link at DiveDay is a clean move, not a fight. The steps below are the same either way.",
    },
  },

  exportHeading: "Get your data out of Rezdy",
  exportIntro:
    "Rezdy runs in a browser, and — to its credit — it's open about letting your data out as CSV. The goal is your people as a spreadsheet. Menu labels shift between updates and Rezdy's own help centre is the authoritative source for the exact path, so treat these as the shape of it, not word-for-word buttons.",
  exportSteps: [
    {
      title: "Sign into your Rezdy dashboard as an owner or manager",
      detail:
        "Reports and your customer list live in the dashboard, behind an owner or manager login.",
    },
    {
      title: "Open the Sales / Orders report (or Reports → Data export)",
      detail:
        "Rezdy's Orders report lists your bookings and the customers on them; the newer Data export covers the same ground. Either one is a route to your people.",
    },
    {
      title: "Set the date range wide and export to CSV",
      detail:
        "Set the range as wide as it goes so a slow season isn't left behind, then use Export to CSV. Rezdy's export includes every column, not just the ones shown on screen.",
    },
    {
      title: "Or export your customer list directly",
      detail:
        "Rezdy has customer-list import/export tooling, so your contacts can come out as their own spreadsheet — whichever is cleaner for you. Save the file where you'll find it.",
    },
    {
      title: "Prefer the API? It's yours to turn on",
      detail:
        "Unlike some booking platforms, Rezdy lets an operator request an API key from Integrations → Rezdy API inside the app. You don't need it for this move — the CSV is enough — but it's there, and it's a fair sign of how open Rezdy is with your data.",
    },
  ],
  exportNotes: [
    "Rezdy doesn't lock your data in — no setup fee, no contract, self-serve CSV export and an operator API. Confirm the exact menu path against Rezdy's own help centre, since labels shift between updates.",
    "Your column headings don't have to match anything. DiveDay recognizes the common names Rezdy and every other system use, and shows you exactly how each column mapped before you commit.",
    "Certification cards and rental sizes aren't in a Rezdy export — a booking engine doesn't hold them (see the scope table below). Expect people and their contact details; certs and sizes you build in DiveDay as divers arrive.",
  ],
  importerNote:
    "A Rezdy export is mostly contact and booking data — expect people, emails, phones, and any emergency contact to import, and no certification cards or rental sizes (a booking platform doesn't hold them). Import the customer or Orders file; DiveDay matches divers by email, so a later re-import updates the same people instead of duplicating them.",
  sources: [
    {
      label: "Rezdy — booking software for tours & activities",
      url: "https://rezdy.com/booking-software/",
    },
    {
      label: "Rezdy Channel Manager — the reseller marketplace",
      url: "https://rezdy.com/channel-manager/",
    },
    {
      label: "Rezdy pricing — subscription plus a per-booking fee",
      url: "https://rezdy.com/pricing/",
    },
    {
      label: "Rezdy Help — the Sales / Orders report and its CSV export",
      url: "https://support.rezdy.com/hc/en-us/articles/203690794-How-To-Use-the-Sales-Orders-Report",
    },
    {
      label: "Rezdy developer docs — the operator-accessible API",
      url: "https://developers.rezdy.com/",
    },
    {
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
 */
export const MIGRATION_GUIDES: MigrationGuide[] = [
  eve,
  diveshop360,
  diveadmin,
  smartwaiver,
  fareharbor,
  rezdy,
];

/** Slugs with a page — the source for generateStaticParams and route validity. */
export const MIGRATION_GUIDE_SLUGS: string[] = MIGRATION_GUIDES.map((guide) => guide.slug);

/** Look up a guide by slug; an unknown slug returns null (→ 404). */
export function getMigrationGuide(slug: string): MigrationGuide | null {
  return MIGRATION_GUIDES.find((entry) => entry.slug === slug) ?? null;
}
