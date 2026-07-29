/**
 * Deterministic staff logins for the seeded demo shop. These credentials are
 * used only for the demo tenant; real shops use their own accounts.
 */
export const DEV_STAFF_LOGINS = {
  owner: { email: "dana@bluemantis.example", password: "password" },
  instructor: { email: "marcus@bluemantis.example", password: "password" },
  divemaster: { email: "keiko@bluemantis.example", password: "password" },
  captain: { email: "sal@bluemantis.example", password: "password" },
} as const;

export const DEMO_SHOP_SLUG = "blue-mantis";
