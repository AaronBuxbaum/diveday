/**
 * **The shop on paper** — ADR 20260908-one-hand, decision 6, lever X.
 *
 * The framework-free half of the one sheet the shop prints from the app on its
 * own paper: the paper pass, handed at the counter to a diver without a phone.
 * Which paper it is printed on, the box that paper leaves, and what its code
 * carries.
 *
 * **A sheet reads what its page reads.** Nothing here is stored copy.
 */

import { publicSchedulePath } from "./public-routes";
import { shopPath } from "./staff-notices";

/**
 * A `@page size` value. Named rather than measured: a sheet is drawn to the
 * paper it is meant for, so the shop's printer is told what to load rather than
 * asked to scale a letter-sized render down to A6.
 */
export type PrintSheetPaper = "A6 portrait";

/** The paper pass's paper. */
export const PAPER_PASS_PAPER: PrintSheetPaper = "A6 portrait";

/** The counter card's paper: the same A6, stood on the desk. */
export const COUNTER_CARD_PAPER: PrintSheetPaper = "A6 portrait";

/**
 * The `@page` block a sheet carries.
 *
 * A margin rather than none: the band and the fold line run to the edge of the
 * sheet by design, and every printer has an unprintable border, so a zero
 * margin is how a shop discovers its sheet lost the top of its own name.
 * The sheet's own box is sized to what is left.
 */
export const PRINT_SHEET_MARGIN_MM = 6;

export function printSheetPageRule(paper: PrintSheetPaper): string {
  return `@page{size:${paper};margin:${PRINT_SHEET_MARGIN_MM}mm}`;
}

/**
 * The printable box of a sheet, in millimetres — the paper less its margins.
 *
 * The height is a **floor**. A sheet whose content outgrows its paper takes a
 * second page rather than clipping.
 */
export const PRINT_SHEET_BOX_MM: Record<PrintSheetPaper, { width: number; height: number }> = {
  "A6 portrait": {
    width: 105 - 2 * PRINT_SHEET_MARGIN_MM,
    height: 148 - 2 * PRINT_SHEET_MARGIN_MM,
  },
};

/**
 * What the paper pass's code carries: the booking's id, and nothing else.
 *
 * Not a URL, not a name, not the shop. A booking id is not a capability — the
 * counter resolves it against the session's own shop — so a pass left on a boat
 * seat hands a finder nothing, and the code cannot become a second, quieter
 * spelling of a waiver link (the capability rule in
 * docs/engineering/capability-telemetry-runbook.md). `print-sheets.test.ts`
 * pins it, because the cheapest way for this to rot is somebody making the code
 * "more useful".
 */
export function passCodePayload(bookingId: string): string {
  return bookingId;
}

/**
 * The storefront's address as a sheet prints it: no scheme, because paper is
 * read by a person rather than clicked.
 *
 * The path alone when the app has no public origin configured — a sheet that
 * printed `https://undefined/s/blue-mantis` would be worse than one that
 * printed nothing, and this is the one line on a sheet that says where the shop
 * lives.
 */
export function storefrontAddress(shopSlug: string, origin: string | null): string {
  const path = publicSchedulePath(shopSlug);
  if (!origin) return path;
  return `${origin.replace(/^https?:\/\//, "").replace(/\/+$/, "")}${path}`;
}

/**
 * Where a booking's paper pass is drawn.
 *
 * Built with `shopPath`, which escapes every segment, so a booking id can never
 * rewrite the route it names.
 */
export function paperPassPath(shopSlug: string, bookingId: string): string {
  return shopPath(shopSlug, "print", "pass", bookingId);
}
