/**
 * Deterministic staff logins for the seeded demo shop — dev and e2e only.
 * These exist solely in local PGlite databases; production seeds nothing
 * (ADR-0005) and requires a real AUTH_SECRET (ADR-0006).
 */
export const DEV_STAFF_LOGINS = {
  owner: { email: "dana@bluemantis.example", password: "dev-owner-password" },
  instructor: { email: "marcus@bluemantis.example", password: "dev-instructor-password" },
  divemaster: { email: "keiko@bluemantis.example", password: "dev-divemaster-password" },
  captain: { email: "sal@bluemantis.example", password: "dev-captain-password" },
} as const;
