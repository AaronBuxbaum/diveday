import path from "node:path";
import { E2E_BASE_PORT } from "../../e2e/servers";
import { E2E_WORKER_PORT_STRIDE } from "../../src/lib/e2e-port";

/**
 * Where the weekly persona walk runs, shared by its Playwright config (which
 * starts the server) and its spec (which drives it), so the two never disagree.
 */

/**
 * One below the one-day simulation's port, at the top of this checkout's e2e
 * port block (`resolveE2EBasePort` hands each checkout a 64-port stride). The
 * fleet's workers count up from the bottom and never reach either, so a walk, a
 * simulation and a focused `pnpm e2e` can share a checkout without collision.
 */
export const WALK_PORT = Number(
  process.env.PERSONA_BOTS_PORT || E2E_BASE_PORT + E2E_WORKER_PORT_STRIDE - 2,
);

export const WALK_BASE_URL = `http://127.0.0.1:${WALK_PORT}`;

/** Where the findings and the screenshots land (gitignored). */
export const WALK_OUT_DIR = path.resolve(process.cwd(), process.env.PERSONA_BOTS_OUT || "personas");

/** The findings file the filing step reads back. */
export const WALK_FINDINGS_FILE = path.join(WALK_OUT_DIR, "findings.json");

/** One persona's id, to walk only them (`pnpm personas --persona nadia`). */
export const WALK_ONLY = process.env.PERSONA_BOTS_ONLY || "";

/** The two devices the personas carry. A phone first, since most of them are on one. */
export const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1279, height: 720 },
} as const;

/**
 * The floor a control must clear on a phone, in CSS pixels — the same number
 * `e2e/a11y.spec.ts` holds three staff pages to, measured the same way (the
 * element's own box, never a pseudo-element overlay a parent may clip).
 */
export const TAP_TARGET_FLOOR_PX = 44;
