/**
 * Deterministic staff logins for the seeded demo shop. These credentials are
 * used only for the demo tenant; real shops use their own accounts.
 */
export const DEV_STAFF_LOGINS = {
  owner: { email: "dana@demo.invalid", password: "password" },
  instructor: { email: "marcus@demo.invalid", password: "password" },
  divemaster: { email: "keiko@demo.invalid", password: "password" },
  captain: { email: "sal@demo.invalid", password: "password" },
} as const;

export const DEMO_SHOP_SLUG = "blue-mantis";
