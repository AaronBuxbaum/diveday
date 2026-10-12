import credentials from "./dev-credentials.json";

/**
 * Deterministic staff logins for the seeded demo shop. These credentials are
 * used only for the demo tenant; real shops use their own accounts.
 *
 * The values live in `dev-credentials.json` so the `.mjs` scripts that drive
 * a running app (`scripts/capture-session.mjs`) read the same file instead of
 * keeping a copy that can drift. The demo shop's slug is in `demo-shop.ts`.
 */
export const DEV_STAFF_LOGINS = credentials.staffLogins;
