/**
 * Public-facing product language lives here so the homepage, product, and
 * pricing pages always describe the same product. Keep claims constrained to
 * workflows that are available in DiveDay today.
 */

export const productFeatureGroups = [
  {
    eyebrow: "Welcome divers well",
    title: "From first click to confirmed place on the boat",
    features: [
      "A live schedule divers book themselves — never past what the boat can hold",
      "Courses, charters, and dive trips on one calendar",
      "A booking widget you paste into the website you already have",
      "Book for the whole party in one go, or as a gift for someone else",
      "Discount codes shop-wide, or a last-minute deal on one under-booked boat",
      "Confirmation emails you can see arrived — and resend when they didn't",
      "Divers share their sizes and gear needs before they ever reach the counter",
      "Every public page in the visitor's own language, English or Spanish",
    ],
  },
  {
    eyebrow: "Get ready before the dock",
    title: "The paperwork, evidence, and exceptions stay together",
    features: [
      "Waivers signed from home, with medical flags raised long before the boat",
      "A medical questionnaire that matches the jurisdiction the shop dives in",
      "C-cards photographed once, certified by staff, and kept with the diver",
      "One honest answer to “is this diver ready?” — waiver, cert, sites, and payment together",
      "Specialty and nitrox cards gated per site and per trip, not per hunch",
      "A clear staff view of exactly what still needs attention",
      "Each diver's own page for what's left, with an emergency contact they fill in",
    ],
  },
  {
    eyebrow: "Run the dive day",
    title: "Crew, prep, and the boat share one source of truth",
    features: [
      "Every diver's rental sizes on the trip's prep list, so the boat is packed without a clipboard",
      "Dive-site briefings with the route and conditions notes crews actually use",
      "Nitrox requested per booking — filled as plain air until the diver's nitrox card is verified",
      "A counter queue built for a line of divers, not a database",
      "Save the manifest to a phone and roll call keeps working with no signal — every dive, print backup included",
      "A boarding history that keeps every correction instead of overwriting it",
      "Crew conditions and an automated marine outlook on the trip a diver already booked",
    ],
  },
  {
    eyebrow: "Keep the shop in motion",
    title: "The next handoff is already clear",
    features: [
      "Build the board itself: add a departure, move it, copy it forward, take it off",
      "Repeating trips put a season on the calendar in one pass",
      "Every trip and class shows who's leading it and who's crewing",
      "A live picture of bookings, blockers, and staffing gaps — before they become tomorrow's problem",
      "Card payments, deposits, invoices, and refunds through the shop's own Stripe account",
      "A recap page each diver keeps, a rating you can publish, and a tip that reaches the crew",
      "Walk the day as the front desk, the captain, or the diver before you commit",
      "Leave any day with a one-ZIP export of your shop's records — no phone call, no fee",
    ],
  },
] as const;

export const earlyAccessPrice = {
  name: "Founding shop",
  price: "$99",
  cadence: "per location / month",
  description: "One clear price for the whole shop — every role, every workflow, no per-seat math.",
  included: [
    "Bookings, courses, waivers, certifications, rental fit, dive sites, nitrox, and the offline-ready manifest",
    "Every staff role, from front desk to captain, in one place",
    "New features as they ship, all through early access",
    "A practice shop preloaded with realistic trips to train on",
    "Today's price, locked for two years — no surprise increases while you help shape what ships next",
    "A founder-direct line for support — write in, hear back from a real person",
  ],
} as const;

/**
 * The bare amount inside `earlyAccessPrice.price`, for structured data that
 * needs a number (JSON-LD offers). Derived here so the figure still has exactly
 * one source; never restate it as a literal.
 */
export const earlyAccessPriceAmount = earlyAccessPrice.price.replace(/[^\d.]/g, "");

/**
 * The full-shop export claim, shared by the home "Safe to leave" band and the
 * pricing data-exit FAQ so the two surfaces can never drift apart. Contents
 * verified against src/lib/export.ts; keep them in sync with the bundle.
 */
export const fullShopExport = {
  claim:
    "Settings → Data export downloads one ZIP of plain, documented CSV files — divers, bookings, waiver records, payment history — led by a contacts file shaped for another system's import wizard, with every stored photo (card images, dive-site pictures, trip recaps) included as a real file, not just a link.",
  terms:
    "No export fee, no support ticket, no minimum stay, and the same download works on the first day of a trial.",
} as const;

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
export const productCapabilityIndex = [
  {
    area: "Booking and the public pages",
    items: [
      "A public schedule with a month calendar, per-departure pages, and capacity that can't be oversold",
      "An embeddable booking widget for the shop's existing website",
      "Party booking, gift booking, and a wait list that recovers a seat when one opens",
      "Shop-wide discount codes and one-trip last-minute deals",
      "A standing last-minute list divers opt into with the dates they're around",
      "Public course pages with prices, prerequisites, day-by-day plans, and dates",
      "Search-engine structured data on the schedule, trip, and course pages",
      "Every diver-facing page in the visitor's negotiated language",
    ],
  },
  {
    area: "Divers, cards, and readiness",
    items: [
      "One page per diver: cards, rental fit, contact, bookings, and history together",
      "Waivers signed from home on an expiring link, with drafts saved as they go",
      "One versioned waiver release per shop, with every signed version kept",
      "A jurisdiction-aware medical questionnaire and a hard medical-review block",
      "Tamper-evident waiver records with a verifiable integrity seal",
      "Certification cards captured with a photo and verified by a person, never by guesswork",
      "Specialty, nitrox, minimum-age, and dive-site gates composed into one readiness answer",
      "A blockers queue that says exactly who isn't ready and why",
    ],
  },
  {
    area: "The dive day",
    items: [
      "A trip page that carries the dive, the roster, the prep list, and the manifest",
      "Per-dive roll-call checkpoints with an append-only boarding history",
      "An encrypted offline manifest saved to the crew's phone, and reconciled when signal returns",
      "A print view of the manifest and prep list from the same data",
      "A rental prep list derived from the sizes divers gave you",
      "Dive-site briefings with routes, landmarks, a field guide, and diver moments",
      "Crew conditions predictions and an automated marine outlook",
      "A counter check-in for the morning rush",
    ],
  },
  {
    area: "Money",
    items: [
      "Card payments at booking through the shop's own Stripe account",
      "Deposits with the balance owed at the dock",
      "A free-cancellation window, with the automated refund when a diver cancels inside it",
      "Staff-issued orders and invoices with trip, course, rental, nitrox, and retail lines",
      "Crew tips a diver starts from their own recap page",
      "Payment state folded into whether a diver is ready to board",
    ],
  },
  {
    area: "Running the shop",
    items: [
      "A Today queue that ranks the work by what sails soonest",
      "A landing page that leads with your own work — captain, instructor, or owner",
      "The schedule as a builder: add, move, copy, and remove departures in place",
      "Repeating trip series, edited and rolled forward as one",
      "A course catalog with certification paths you define yourself",
      "Staff roles with real boundaries, and a staffing view that shows coverage gaps",
      "Saved diver views and search that jumps straight to a diver or a trip",
      "Reports on the numbers a shop actually asks about",
    ],
  },
  {
    area: "Your records",
    items: [
      "A one-ZIP export of every record, in documented CSVs, on any day of a trial",
      "Photos included as real files, not links that expire with the account",
      "A contacts file shaped for another system's import wizard",
      "A diver importer that marks what it trusted and what it left behind",
      "Prior visits carried across from your old system, kept honestly separate from dives here",
      "Email delivery history you can read, with a resend when one doesn't land",
    ],
  },
] as const;
