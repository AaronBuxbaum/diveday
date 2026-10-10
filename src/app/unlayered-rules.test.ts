import { describe, expect, it } from "vitest";
import { baseLayerRules, readGlobalsCss, unlayeredRules } from "@/test/stylesheet";

/**
 * **An element rule written outside a layer beats every utility, so one has
 * to say why it is out there** (#1990).
 *
 * Tailwind v4 emits every utility inside `@layer utilities`, and an unlayered
 * declaration beats every layered one whatever its specificity. A bare
 * `input { color }` therefore defeats every `text-*` on every input, silently:
 * the command palette asked for `placeholder:text-muted` and drew the global
 * 78% shade, and the conditions-hold checkbox asked for `accent-current` and
 * drew `--primary`. The global focus ring was the expensive one (1,700 clipped
 * rings, `focus-ring.test.ts`). An element default belongs in `@layer base`,
 * where it is a default.
 *
 * Some must beat a utility, and each of those is on the list below with the
 * reason. The reason is the point: an entry without one would make the list
 * the new unlayered block.
 *
 * "Element rule" means every selector in the list ends on a type selector (or
 * `*`) and names no class or id anywhere — the rules whose only intent is
 * "every element of this kind". A rule scoped by a class (`.paper-sheet`,
 * `.boat-mode`) or one whose subject is an attribute (`[data-skip-link]`) is
 * not about an element and is not this check's business.
 */
const ALLOWED: Record<string, string> = {
  "select:not([multiple]):not([size])":
    "The closed select's arrow strip: its padding-inline-end must beat controlClass's px-3, or option text runs under the arrow on every select.",
  "select:not([multiple]):not([size]):dir(rtl)":
    "The same arrow, mirrored for right-to-left; it moves with the rule above.",
  body: "The document's ground, ink, face and overflow-x: clip, which must hold whatever a layout puts on <body>; the page never scrolls sideways.",
  "html:has([data-staff-sidebar])":
    "Publishes --shell-start, the sidebar's width, to the page: a custom property no utility writes, not an element default.",
  "html:has([data-staff-tabbar])":
    "Publishes --tabbar-h on a phone: a custom property no utility writes, as the sidebar's.",
  "html:has([data-chrome-bar])":
    "Shell geometry the chrome bar publishes (its height as scroll padding), which every sticky offset reads.",
  "html:has([data-sticky-actions])":
    "Scroll padding for a page with a sticky action bar, so a jumped-to field lands above it.",
  "html:has([data-foot-bar])": "Scroll padding for a page with a foot bar, as above.",
  "body:has([data-foot-bar])":
    "Room under the last line for the foot bar, which nothing on <body> sets.",
  'button[type="submit"]':
    "Print: a submit button has nothing to say on paper, and the print sheet must beat any display utility on it.",
  html: "Print: the sheet's 13px root size, which every rem on the page reads; no utility sets it.",
  "*, *::before, *::after":
    "Print's white sheet and the reduced-motion kill-switch, each !important by design so it beats every utility.",
  "li, tr, thead": "Print: rows never split across a page, whatever a utility asked for on screen.",
  "h1, h2, h3, h4": "Print: a heading never ends a page, whatever a utility asked for on screen.",
  thead: "Print: a long table repeats its header on every page.",
  "details::details-content":
    "The disclosure's open and close motion; no utility reaches the ::details-content pseudo-element, and the reduced-motion copy must beat it.",
  "details[open]::details-content": "The open half of the same motion.",
  "details::details-content, details[open]::details-content":
    "Reduced motion: the disclosure opens without travelling, and that must beat the motion above.",
};

/** Split on commas that are not inside parentheses or brackets. */
function selectorList(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of prelude) {
    if (char === "(" || char === "[") depth++;
    if (char === ")" || char === "]") depth--;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

/** `a > b:hover` → `b:hover`: the compound after the last combinator, outside parentheses. */
function subject(selector: string): string {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(char ?? "")) start = index + 1;
  }
  return selector.slice(start);
}

/** A class or an id outside brackets and quotes. */
function namesClassOrId(selector: string): boolean {
  return /[.#]/.test(selector.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, ""));
}

function isElementRule(prelude: string): boolean {
  return selectorList(prelude).every(
    (selector) => /^(\*|[a-z][a-z0-9-]*)/.test(subject(selector)) && !namesClassOrId(selector),
  );
}

const CSS = readGlobalsCss();
const normalise = (prelude: string) => prelude.replace(/\s+/g, " ").trim();
const unlayeredElementRules = unlayeredRules(CSS)
  .map((rule) => normalise(rule.prelude))
  .filter(isElementRule);

describe("unlayered element rules", () => {
  it("recognizes an element rule and leaves a class-scoped one alone", () => {
    expect(isElementRule("input, select, textarea")).toBe(true);
    expect(isElementRule("input::placeholder")).toBe(true);
    expect(isElementRule('html:has([data-foot-bar="x"])')).toBe(true);
    expect(isElementRule(".boat-mode input")).toBe(false);
    expect(isElementRule('body:has([data-x]) [data-skip-link="root"]')).toBe(false);
    expect(isElementRule("html:has(#shop-main-content > main)")).toBe(false);
  });

  it("stands outside a layer only from the list, and each entry says why", () => {
    const strays = unlayeredElementRules.filter((prelude) => !(prelude in ALLOWED));
    expect(
      strays,
      "an unlayered element rule beats every utility; put it in @layer base, or add it to ALLOWED with the reason it must win",
    ).toEqual([]);
    for (const [prelude, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, `${prelude} needs a reason, in a sentence`).toBeGreaterThan(30);
    }
  });

  it("lists nothing that has since moved into a layer", () => {
    const present = new Set(unlayeredElementRules);
    expect(Object.keys(ALLOWED).filter((prelude) => !present.has(prelude))).toEqual([]);
  });

  it("keeps the element defaults a utility may change in @layer base", () => {
    const base = baseLayerRules(CSS).map((rule) => normalise(rule.prelude));
    for (const prelude of [
      "input, select, textarea",
      "input::placeholder, textarea::placeholder",
      "summary",
      "button, a, summary, input, select, textarea",
    ]) {
      expect(base, prelude).toContain(prelude);
    }
  });
});
