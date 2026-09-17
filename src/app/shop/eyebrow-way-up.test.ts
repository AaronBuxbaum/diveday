import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Every staff surface below depth 1 names its parent and links to it**
 * (`docs/design/principles.md` §10, issue #823).
 *
 * The principle allows exactly two forms, chosen by whether the page's header
 * is `ShopPageHeader`: the eyebrow *is* the link (`eyebrowHref`), or an
 * `EyebrowBackLink` for a header that is not that component (the four trip
 * surfaces share `TripPageHeader`, which renders one). Never a third — and a
 * "Back to …" button in the header's actions slot, or a "← Back to …" link
 * stranded under the header, are both third forms: they sit at the weight of
 * the act the page exists for, and which one a page got was a function of when
 * it was written.
 *
 * Why this is a test and not a review note: a page with no way up is
 * individually fine. Nothing in its diff looks wrong, every assertion about it
 * passes, and the global nav is one tap away, so nobody filing a bug can point
 * at a break. It only reads as a defect in aggregate — as the four grammars a
 * sweep of the whole staff app found on one afternoon, five months after the
 * principle was written. The next page added below depth 1 would have made it
 * five.
 *
 * The scan is deliberately syntactic: it asks whether a marker appears in the
 * route's own sources, never whether the href is correct. That is the half a
 * machine can hold. The *word* — the parent destination's own label from
 * `STAFF_DESTINATION_LABEL_KEYS`, never a second copy in the page's bundle —
 * is a reading, and it stays one.
 */

const SHOP_DIR = join(dirname(fileURLToPath(import.meta.url)), "[shopSlug]");

/**
 * Any of these in a route's sources means the page has a way up.
 *
 * `TripPageHeader` counts because it renders an `EyebrowBackLink` itself and
 * takes the label as a prop — the four trip surfaces are the case that named
 * the rule, and they satisfy it through that one component.
 */
const WAY_UP_MARKERS = ["eyebrowHref", "EyebrowBackLink", "TripPageHeader"];

/**
 * Routes below depth 1 with no eyebrow link, and the reason each is right.
 *
 * Keyed by the directory holding the `page.tsx`, relative to
 * `src/app/shop/[shopSlug]`, with `/` separators.
 */
const WAY_UP_EXEMPT: Record<string, string> = {
  "schedule/board":
    "A first-class destination wearing two URL segments: `/schedule` has no page, so the board is a depth-1 surface and its eyebrow is its own name, per principle 10's first bullet.",
  "print/boat-card/[boatId]":
    "A printed sheet, not a screen. `SheetDocument` carries the way back to the print register as its own `print:hidden` link, because paper has no eyebrow.",
  "print/dock-sign":
    "A printed sheet, not a screen. `SheetDocument` carries the way back to the print register as its own `print:hidden` link, because paper has no eyebrow.",
  "print/pass/[bookingId]":
    "A printed sheet, not a screen. `SheetDocument` carries the way back to the print register as its own `print:hidden` link, because paper has no eyebrow.",
  "print/site-briefings":
    "A printed sheet, not a screen. `SheetDocument` carries the way back to the print register as its own `print:hidden` link, because paper has no eyebrow.",
  "print/window-sticker":
    "A printed sheet, not a screen. `SheetDocument` carries the way back to the print register as its own `print:hidden` link, because paper has no eyebrow.",
};

type StaffRoute = {
  /** The route's directory relative to `[shopSlug]`, `/`-separated. */
  readonly key: string;
  /** How many URL segments below `/shop/<shopSlug>` the page sits. */
  readonly depth: number;
  /** Whether a way-up marker appears in the page or its own `_components`. */
  readonly hasWayUp: boolean;
};

/** Every `.tsx` under one directory, at any depth; nothing when it does not exist. */
function tsxFilesUnder(directory: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...tsxFilesUnder(path));
    else if (entry.name.endsWith(".tsx")) files.push(path);
  }
  return files;
}

/** Every `.tsx` file directly owned by one route: its page and its `_components`. */
function routeSources(directory: string): string[] {
  return [join(directory, "page.tsx"), ...tsxFilesUnder(join(directory, "_components"))];
}

function staffRoutes(directory = SHOP_DIR): StaffRoute[] {
  const found: StaffRoute[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });

  if (entries.some((entry) => entry.isFile() && entry.name === "page.tsx")) {
    const relativePath = relative(SHOP_DIR, directory);
    const segments = relativePath === "" ? [] : relativePath.split(sep);
    if (segments.length >= 2) {
      const sources = routeSources(directory).map((file) => readFileSync(file, "utf8"));
      found.push({
        key: segments.join("/"),
        depth: segments.length,
        hasWayUp: sources.some((source) =>
          WAY_UP_MARKERS.some((marker) => source.includes(marker)),
        ),
      });
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    found.push(...staffRoutes(join(directory, entry.name)));
  }
  return found;
}

const routes = staffRoutes();

describe("every staff surface below depth 1 has one way up", () => {
  it("finds the sub-pages to check", () => {
    // A guard that silently stops walking the tree passes forever. The floor is
    // well under the count today and only asserts that the scan found a tree.
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.some((route) => route.depth >= 3)).toBe(true);
  });

  it("links every one of them to its parent", () => {
    const missing = routes
      .filter((route) => !route.hasWayUp && !Object.hasOwn(WAY_UP_EXEMPT, route.key))
      .map((route) => route.key);
    expect(missing).toEqual([]);
  });

  it("keeps no exemption that has stopped being true", () => {
    const stale = Object.keys(WAY_UP_EXEMPT).filter((key) => {
      const route = routes.find((candidate) => candidate.key === key);
      return route === undefined || route.hasWayUp;
    });
    expect(stale).toEqual([]);
  });

  it("gives every exemption a reason a reader can weigh", () => {
    for (const [key, reason] of Object.entries(WAY_UP_EXEMPT)) {
      expect(reason.length, key).toBeGreaterThan(40);
    }
  });
});
