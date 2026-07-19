/**
 * Public-facing product language lives here so the homepage, product, and
 * pricing pages always describe the same product. Keep claims constrained to
 * workflows that are available in Scuba today.
 */

export const productFeatureGroups = [
  {
    eyebrow: "Welcome divers well",
    title: "From first click to confirmed place on the boat",
    features: [
      "A public schedule with capacity-aware booking",
      "Course sessions alongside charters and dive trips",
      "Booking confirmations with delivery history and retry visibility",
      "Diver rental requests with fit preferences before arrival",
    ],
  },
  {
    eyebrow: "Get ready before the dock",
    title: "The paperwork, evidence, and exceptions stay together",
    features: [
      "Versioned waiver links, saved progress, and medical-review blockers",
      "C-card capture with staff verification and assistive agency checks",
      "One fail-closed readiness result for waiver, certification, sites, specialties, and payment",
      "A clear staff view of exactly what still needs attention",
    ],
  },
  {
    eyebrow: "Run the dive day",
    title: "Crew, gear, and the boat share one source of truth",
    features: [
      "Rental inventory, service holds, packing recommendations, and returns",
      "Dive-site briefings with practical route and conditions context",
      "Nitrox analysis with certification gating and a derived MOD",
      "An encrypted offline boat manifest with per-dive roll call, explicit sync, and print support",
    ],
  },
  {
    eyebrow: "Keep the shop in motion",
    title: "The next handoff is already clear",
    features: [
      "Instructor and crew assignment on every trip and course session",
      "Live operational reporting for bookings, blockers, gear requests, and staffing gaps",
      "Role-shaped demo experiences to see the day from the desk, dock, or diver's phone",
      "A multi-tenant shop workspace that starts with useful demo data",
    ],
  },
] as const;

export const earlyAccessPrice = {
  name: "Founding shop",
  price: "$249",
  cadence: "per location / month",
  description:
    "One clear price for the complete current operating system — not a seat-by-seat add-on.",
  included: [
    "Bookings, courses, waivers, certifications, gear, dive sites, nitrox, and offline manifests",
    "All staff roles in one shop workspace",
    "New workflow releases while early access is open",
    "A dedicated practice shop with seeded demo data",
  ],
} as const;
