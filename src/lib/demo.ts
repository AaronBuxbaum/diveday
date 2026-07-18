import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";

/**
 * Demo mode: a prospective customer can drop into a live, pre-populated example
 * shop, drive the staff surfaces, and reset the mess back to a clean slate — no
 * signup, no sales call (docs ADR 20260718-demo-mode).
 *
 * This module is the gate and the identity of the demo. Everything demo-flavored
 * (the entry CTA, the one-click sign-in, the reset banner) hangs off isDemoMode()
 * so the whole experience can never appear in a real shop's production instance.
 */

/** The seeded shop that backs the demo (src/db/seed.ts). */
export const DEMO_SHOP_SLUG = "blue-mantis";

/**
 * The owner login the one-click demo entry authenticates as. It is the ordinary
 * seeded owner account — demo entry surfaces a known login, it does not bypass
 * the credentials flow (docs ADR 20260718-demo-mode, ADR-0006).
 */
export const DEMO_OWNER_LOGIN = DEV_STAFF_LOGINS.owner;

/**
 * Is the demo experience enabled for this deployment? On everywhere except
 * production by default (dev, tests, and preview builds want it), and switchable
 * either way with SCUBA_DEMO so a dedicated demo deployment can opt in and a real
 * production instance can stay explicitly opted out.
 */
export function isDemoMode(
  env: Partial<Record<"NODE_ENV" | "SCUBA_DEMO", string | undefined>> = process.env,
): boolean {
  const flag = env.SCUBA_DEMO?.trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "on") return true;
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return env.NODE_ENV !== "production";
}
