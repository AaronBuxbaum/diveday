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
      "Confirmation emails you can see arrived — and resend when they didn't",
      "Divers share their sizes and gear needs before they ever reach the counter",
    ],
  },
  {
    eyebrow: "Get ready before the dock",
    title: "The paperwork, evidence, and exceptions stay together",
    features: [
      "Waivers signed from home, with medical flags raised long before the boat",
      "C-cards photographed once, verified by staff, and kept with the diver",
      "One honest answer to “is this diver ready?” — waiver, cert, sites, and payment together",
      "A clear staff view of exactly what still needs attention",
    ],
  },
  {
    eyebrow: "Run the dive day",
    title: "Crew, prep, and the boat share one source of truth",
    features: [
      "Every diver's rental sizes on the trip's prep list, so the boat is packed without a clipboard",
      "Dive-site briefings with the route and conditions notes crews actually use",
      "Nitrox requested per booking — filled as plain air until the diver's enriched-air card is verified",
      "Save the manifest to a phone and roll call keeps working with no signal — every dive, print backup included",
    ],
  },
  {
    eyebrow: "Keep the shop in motion",
    title: "The next handoff is already clear",
    features: [
      "Every trip and class shows who's leading it and who's crewing",
      "A live picture of bookings, blockers, and staffing gaps — before they become tomorrow's problem",
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
    "A founder-direct line for support — write in, hear back the same day",
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
