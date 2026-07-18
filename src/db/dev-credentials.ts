/**
 * Deterministic staff logins for the seeded demo shop. These credentials are
 * used only for the demo tenant; real shops use their own accounts.
 */
export const DEV_STAFF_LOGINS = {
  owner: { email: "dana@bluemantis.example", password: "dev-owner-password" },
  instructor: { email: "marcus@bluemantis.example", password: "dev-instructor-password" },
  divemaster: { email: "keiko@bluemantis.example", password: "dev-divemaster-password" },
  captain: { email: "sal@bluemantis.example", password: "dev-captain-password" },
} as const;

export const DEMO_SHOP_SLUG = "blue-mantis";
