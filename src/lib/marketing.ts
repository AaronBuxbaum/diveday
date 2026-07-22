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
      "Rental gear packed, tracked, and back on the shelf without a clipboard",
      "Dive-site briefings with the route and conditions notes crews actually use",
      "Nitrox fills logged with the diver's card checked and the MOD worked out for you",
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
      "Your own shop workspace, ready with realistic practice data on day one",
    ],
  },
] as const;

export const earlyAccessPrice = {
  name: "Founding shop",
  price: "$149",
  cadence: "per location / month",
  description: "One clear price for the whole shop — every role, every workflow, no per-seat math.",
  included: [
    "Bookings, courses, waivers, certifications, rental fit, dive sites, nitrox, and the offline-ready manifest",
    "Every staff role, from front desk to captain, in one place",
    "New features as they ship, all through early access",
    "A practice shop preloaded with realistic trips to train on",
  ],
} as const;
