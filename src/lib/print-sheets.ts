/**
 * **The shop on paper** — ADR 20260908-one-hand, decision 6, lever X.
 *
 * The sign at the slip, the card taped to the console, the sticker on the door
 * and the sheet a diver without a phone is handed are, in most shops, a
 * laminated Word document in somebody else's font. This module is the
 * framework-free half of giving them the shop's own: which sheets exist, what
 * paper each is printed on, and where in the shop's world the paper goes.
 *
 * Two rules the sheets themselves obey and this file exists to hold:
 *
 * - **A sheet reads what its page reads.** Nothing here is stored copy; the
 *   only thing a print run records is the day it happened, so a sheet can say
 *   how old it is (`printRunSubjectKey` below is the whole persistence
 *   surface).
 * - **Nothing that rides a boat wears the shop's colour.** The boat card is
 *   drawn in the boat's own action colour on both its sides, which is why
 *   {@link PRINT_SHEETS} carries `wearsShopColour` rather than leaving the
 *   decision to each template (the coral and photo bans of ADR
 *   20260901-diveday-reimagined, decision 2, restated on paper).
 */

import { publicSchedulePath } from "./public-routes";
import { shopPath } from "./staff-notices";

/**
 * Every sheet the Print register lists, as a code.
 *
 * `year_poster` is the one row with no template of its own: the year card is a
 * sibling slice (lever T), and until it lands the row opens Reports rather than
 * drawing a poster DiveDay would have to invent.
 */
export const PRINT_SHEET_CODES = [
  "dock_sign",
  "window_sticker",
  "boat_card",
  "site_briefing",
  "paper_pass",
  "year_poster",
] as const;

export type PrintSheetCode = (typeof PRINT_SHEET_CODES)[number];

/**
 * The sheets a print run can be recorded for — every code but the year poster,
 * whose row opens Reports rather than drawing anything. Pinned against the
 * `print_sheet` database enum in `src/db/print-runs.ts`, so adding a sheet to
 * one and not the other is a compile error rather than a row nobody can write.
 */
export type PrintRunSheetCode = Exclude<PrintSheetCode, "year_poster">;

/** Where in the shop's world the paper goes. The register's reading order. */
export const PRINT_SHEET_GROUPS = ["dock", "boat", "diver", "wall"] as const;

export type PrintSheetGroup = (typeof PRINT_SHEET_GROUPS)[number];

/**
 * A `@page size` value. Named rather than measured: a sheet is drawn to the
 * paper it is meant for, so the shop's printer is told what to load rather than
 * asked to scale a letter-sized render down to A5.
 */
export type PrintSheetPaper =
  | "A3 portrait"
  | "A5 landscape"
  | "A6 portrait"
  | "100mm 100mm"
  | "A2 portrait";

export type PrintSheetSpec = {
  code: PrintSheetCode;
  group: PrintSheetGroup;
  paper: PrintSheetPaper;
  /**
   * Whether the register lists one row per subject (a boat) rather than one
   * row for the sheet.
   */
  perBoat: boolean;
  /**
   * Whether this sheet wears the shop's colour and display face. False for
   * anything that rides a boat: the boat card takes the boat's own action
   * colour, day side and night side, so a hull's card never depends on what a
   * shop picked for its storefront.
   */
  wearsShopColour: boolean;
  /**
   * Whether the register's row opens the sheet itself. The paper pass prints
   * from a booking at the counter and the year poster opens Reports, so neither
   * has a door of its own here.
   */
  printsFromRegister: boolean;
};

export const PRINT_SHEETS: readonly PrintSheetSpec[] = [
  {
    code: "dock_sign",
    group: "dock",
    paper: "A3 portrait",
    perBoat: false,
    wearsShopColour: true,
    printsFromRegister: true,
  },
  {
    code: "window_sticker",
    group: "dock",
    paper: "100mm 100mm",
    perBoat: false,
    wearsShopColour: true,
    printsFromRegister: true,
  },
  {
    code: "boat_card",
    group: "boat",
    paper: "A5 landscape",
    perBoat: true,
    // The one sheet that rides a boat. Its band is the boat's action colour on
    // the day side and the boat night palette's on the night side; the shop's
    // colour reaches neither.
    wearsShopColour: false,
    printsFromRegister: true,
  },
  {
    code: "site_briefing",
    group: "boat",
    paper: "A5 landscape",
    perBoat: false,
    wearsShopColour: true,
    printsFromRegister: true,
  },
  {
    code: "paper_pass",
    group: "diver",
    paper: "A6 portrait",
    perBoat: false,
    wearsShopColour: true,
    // Printed from a booking at the counter, so the register names it and
    // points there rather than offering a door with no diver behind it.
    printsFromRegister: false,
  },
  {
    code: "year_poster",
    group: "wall",
    paper: "A2 portrait",
    perBoat: false,
    wearsShopColour: true,
    printsFromRegister: false,
  },
];

const BY_CODE = new Map(PRINT_SHEETS.map((sheet) => [sheet.code, sheet]));

export function printSheetSpec(code: PrintSheetCode): PrintSheetSpec {
  const spec = BY_CODE.get(code);
  // Unreachable through the type, and cheap insurance against a code arriving
  // from a form field that was not narrowed first.
  if (!spec) throw new Error(`unknown print sheet: ${code}`);
  return spec;
}

export function isPrintSheetCode(value: unknown): value is PrintSheetCode {
  return typeof value === "string" && BY_CODE.has(value as PrintSheetCode);
}

/** The sheets of one group, in register order. */
export function printSheetsInGroup(group: PrintSheetGroup): readonly PrintSheetSpec[] {
  return PRINT_SHEETS.filter((sheet) => sheet.group === group);
}

/**
 * The key a print run is recorded under.
 *
 * One row per sheet per subject, so "printed Aug 12" is a lookup rather than a
 * scan of a log. Empty string for a sheet with no subject: Postgres treats
 * nulls as distinct in a unique index, so a nullable subject would silently
 * allow a second row for the same sheet and the register would start showing
 * whichever one the planner reached first.
 */
export function printRunSubjectKey(subjectId?: string | null): string {
  return subjectId ?? "";
}

/**
 * The `@page` block a sheet carries.
 *
 * A margin rather than none: the band and the fold line run to the edge of the
 * sheet by design, and every printer has an unprintable border, so a zero
 * margin is how a shop discovers its dock sign lost the top of its own name.
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
 * second page rather than clipping: the site briefing card carries prose of
 * whatever length the shop wrote, and a card that cut it off would be read on a
 * boat as the whole briefing.
 */
export const PRINT_SHEET_BOX_MM: Record<PrintSheetPaper, { width: number; height: number }> = {
  "A3 portrait": {
    width: 297 - 2 * PRINT_SHEET_MARGIN_MM,
    height: 420 - 2 * PRINT_SHEET_MARGIN_MM,
  },
  "A5 landscape": {
    width: 210 - 2 * PRINT_SHEET_MARGIN_MM,
    height: 148 - 2 * PRINT_SHEET_MARGIN_MM,
  },
  "A6 portrait": {
    width: 105 - 2 * PRINT_SHEET_MARGIN_MM,
    height: 148 - 2 * PRINT_SHEET_MARGIN_MM,
  },
  "100mm 100mm": {
    width: 100 - 2 * PRINT_SHEET_MARGIN_MM,
    height: 100 - 2 * PRINT_SHEET_MARGIN_MM,
  },
  "A2 portrait": {
    width: 420 - 2 * PRINT_SHEET_MARGIN_MM,
    height: 594 - 2 * PRINT_SHEET_MARGIN_MM,
  },
};

/**
 * A line on the boat card's numbers block: a label, and either the shop's own
 * value or nothing.
 *
 * **Nothing is the point.** A number DiveDay invented is worse on this card
 * than a ruled blank a skipper fills in with a marker, because the crew dialling
 * it has spent the minute finding out (`src/lib/emergency-reference.ts` states
 * the same rule for the screen). So a missing value is `null` here and prints
 * as a rule, and no caller may substitute a default.
 */
/**
 * A line on the boat card's numbers block: a stable key, a label, and either
 * the shop's own value or nothing.
 *
 * **Nothing is the point.** A number DiveDay invented is worse on this card
 * than a ruled blank a skipper fills in with a marker, because the crew
 * dialling it has spent the minute finding out
 * (`src/lib/emergency-reference.ts` states the same rule for the screen). So a
 * missing value is `null` here and prints as a rule, and no caller may
 * substitute a default.
 *
 * **The key is the position, never the label.** A shop's reference lines are
 * free text and `normalizeEmergencyReference` keeps a line with a number and no
 * label at all, so two blank or repeated labels are an ordinary state — and
 * keying a rendered list by label would collapse them into one and drop a
 * number off the card.
 */
export type BoatCardNumber = { key: string; label: string; value: string | null };

/**
 * The numbers the boat card prints, in the order a crew reads them.
 *
 * The vessel leads, because it is the first thing a rescue coordinator asks
 * for and the crew reading this card is the one being asked. Then the shop and
 * whoever is ashore, then the shop's own lines in the order the shop wrote
 * them. Every slot prints whether or not it is filled in.
 */
export function boatCardNumbers(input: {
  vesselLabel: string;
  vessel: string | null;
  shopLabel: string;
  shopPhone: string | null;
  shoreLabel: string;
  shoreContact: string | null;
  reference: readonly { label: string; phone: string }[];
}): BoatCardNumber[] {
  return [
    { key: "vessel", label: input.vesselLabel, value: blankToNull(input.vessel) },
    { key: "shop", label: input.shopLabel, value: blankToNull(input.shopPhone) },
    { key: "ashore", label: input.shoreLabel, value: blankToNull(input.shoreContact) },
    ...input.reference.map((line, index) => ({
      key: `line-${index}`,
      label: line.label.trim(),
      value: blankToNull(line.phone),
    })),
  ];
}

/**
 * How much of the shop's emergency action plan the boat card carries.
 *
 * The card is two faces of one lamination and must not paginate, so the plan —
 * free prose of whatever length a shop retyped — is bounded here rather than
 * left to overrun the sheet. The cut is on a word boundary and carries a real
 * ellipsis, so a crew can see the card is showing part of a longer plan instead
 * of reading a sentence that stops mid-thought.
 *
 * The budget is the half-column the card has for it at A5 landscape, measured
 * against the seeded shop's own plan. A shop whose plan does not fit on half a
 * laminated card has a plan for a folder, not for a console.
 */
export const BOAT_CARD_PLAN_CHARS = 240;

export function boatCardPlan(
  plan: string | null | undefined,
  limit = BOAT_CARD_PLAN_CHARS,
): string | null {
  const trimmed = plan?.trim() ?? "";
  if (trimmed.length === 0) return null;
  if (trimmed.length <= limit) return trimmed;
  const cut = trimmed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

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
 * The storefront's address as a sheet prints it: no scheme, because a sign at
 * the slip is read by a person rather than clicked.
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
 * **The boat card's colours, and only the boat card's.**
 *
 * Nothing that rides a boat wears the shop's colour (ADR
 * 20260901-diveday-reimagined, decision 2, restated on paper), so the card is
 * drawn in boat mode's own action colour by day and on the night ground a red
 * torch reads by night — whose band takes the body's own off-white ink, because
 * a red torch is monochromatic and boat mode's night cyan goes to nothing under
 * one. Stated as values rather than read from `--primary`
 * because `@media print` redefines that token to repaint the app monochrome;
 * `print-sheets.test.ts` pins each against the block in `globals.css` it is a
 * copy of, so a palette that moved without these moving fails rather than
 * printing a card in a colour the app no longer uses.
 */
export const BOAT_CARD_DAY = { band: "#075985", bandInk: "#ffffff" } as const;
export const BOAT_CARD_NIGHT = { band: "#000a0f", bandInk: "#f4fbfc", night: true } as const;

/**
 * Where a sheet is drawn.
 *
 * Built with `shopPath`, which escapes every segment, so a subject id that
 * arrived from a form can never rewrite the route it names. `null` for the two
 * rows that are not sheets — the year poster, which opens Reports, and a
 * per-boat card with no boat named.
 */
export function printSheetPath(
  shopSlug: string,
  sheet: PrintSheetCode,
  subjectId?: string | null,
): string | null {
  switch (sheet) {
    case "dock_sign":
      return shopPath(shopSlug, "print", "dock-sign");
    case "window_sticker":
      return shopPath(shopSlug, "print", "window-sticker");
    case "site_briefing":
      return shopPath(shopSlug, "print", "site-briefings");
    case "boat_card":
      return subjectId ? shopPath(shopSlug, "print", "boat-card", subjectId) : null;
    case "paper_pass":
      return subjectId ? shopPath(shopSlug, "print", "pass", subjectId) : null;
    case "year_poster":
      return null;
  }
}
