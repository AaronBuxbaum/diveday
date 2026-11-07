import type { Page } from "@playwright/test";

/**
 * **The ink audit**: paper spends no ink on colour, fill or bars
 * (`.claude/rules/print-ink.md`).
 *
 * Run against a page already in print media, it reads the *computed* style of
 * every element the printer would draw and fails on any of:
 *
 * - a background that is not transparent or white, or a background image;
 * - text, a border or an SVG paint that is not achromatic, or text that is
 *   light on white (white-on-black reads as text on a dark fill);
 * - a box shadow (a ring is one) or a text shadow;
 * - a border over a hairline on one side or unevenly (a bar). A hollow box
 *   with the same line on all four sides, up to 2px (a checkbox, a marker
 *   ring, a `data-print-critical` outline), is an outline, not a block.
 *
 * Images and the content they carry (a diver's photo, a map tile) are the
 * shop's content, not styling, and are not audited; their wrappers are.
 */

/** A border at or under this is a hairline; anything thicker is a block of ink. */
const HAIRLINE_PX = 1.01;
/** A full outline (all four sides alike) may be this heavy: a checkbox or marker ring is not a bar. */
const OUTLINE_MAX_PX = 2.01;
/** Channels may differ by this much and still read as grey. */
const GREY_TOLERANCE = 6;
/** Text lighter than this (0-255) is not ink on white. */
const TEXT_MAX_CHANNEL = 140;

export type InkViolation = { path: string; problem: string };

export async function printInkViolations(page: Page): Promise<InkViolation[]> {
  return page.evaluate(
    ({ hairline, outlineMax, tolerance, textMax }) => {
      // The browser's own colour parser (a canvas), so oklch(), color-mix() and
      // `/NN` opacity modifiers read as the pixels they print, not as a miss.
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const paint = canvas.getContext("2d", { willReadFrequently: true });
      const parse = (value: string): [number, number, number, number] | null => {
        if (!paint || !value || value === "none") return null;
        paint.clearRect(0, 0, 1, 1);
        paint.fillStyle = "#000000";
        paint.fillStyle = value;
        paint.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0, a = 0] = paint.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      const grey = (c: [number, number, number, number]) =>
        Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) <= tolerance;
      const path = (element: Element) => {
        const parts: string[] = [];
        for (
          let node: Element | null = element;
          node && parts.length < 4;
          node = node.parentElement
        ) {
          const id = node.id ? `#${node.id}` : "";
          const cls = [...node.classList].slice(0, 2).join(".");
          parts.unshift(`${node.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ""}`);
        }
        return parts.join(" > ");
      };
      const zoomOf = (element: Element) =>
        (element as Element & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
      const found: { path: string; problem: string }[] = [];
      const add = (element: Element, problem: string) =>
        found.push({ path: path(element), problem });
      for (const element of document.body.querySelectorAll("*")) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        const critical = element.closest("[data-print-critical]") !== null;
        const own = element.matches("[data-print-critical]");

        for (const pseudo of ["::before", "::after"] as const) {
          const generated = getComputedStyle(element, pseudo);
          if (generated.content === "none" || generated.content === "normal") continue;
          const fill = parse(generated.backgroundColor);
          if (fill && fill[3] > 0 && !(fill[0] > 250 && fill[1] > 250 && fill[2] > 250)) {
            add(element, `${pseudo} filled background ${generated.backgroundColor}`);
          }
          if (generated.backgroundImage !== "none") add(element, `${pseudo} background image`);
          if (generated.boxShadow !== "none") add(element, `${pseudo} shadow or ring`);
        }
        if (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) {
          const line = parse(style.outlineColor);
          if (line && line[3] > 0 && !grey(line))
            add(element, `coloured outline ${style.outlineColor}`);
          if (Number.parseFloat(style.outlineWidth) * zoomOf(element) > outlineMax)
            add(element, `${style.outlineWidth} outline`);
        }

        const background = parse(style.backgroundColor);
        if (
          background &&
          background[3] > 0 &&
          !(background[0] > 250 && background[1] > 250 && background[2] > 250)
        ) {
          add(element, `filled background ${style.backgroundColor}`);
        }
        if (style.backgroundImage !== "none")
          add(element, `background image ${style.backgroundImage.slice(0, 60)}`);
        if (style.boxShadow !== "none")
          add(element, `shadow or ring ${style.boxShadow.slice(0, 60)}`);
        if (style.textShadow !== "none") add(element, "text shadow");

        const hasText = [...element.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
        );
        const ink = parse(style.color);
        if (hasText && ink && ink[3] > 0) {
          if (!grey(ink)) add(element, `coloured text ${style.color}`);
          else if (Math.max(ink[0], ink[1], ink[2]) > textMax)
            add(element, `light text ${style.color}`);
        }

        // Widths as drawn on the page: a sheet's contents are zoomed
        // (`.paper-sheet > *`, globals.css), and a computed width is in the
        // element's own zoomed units, so a 1px rule there reads 1.23px.
        const zoom = zoomOf(element);
        const widths = (["Top", "Right", "Bottom", "Left"] as const).map((side) =>
          style[`border${side}Style` as "borderTopStyle"] === "none"
            ? 0
            : Math.round(
                (Number.parseFloat(style[`border${side}Width` as "borderTopWidth"]) || 0) *
                  zoom *
                  100,
              ) / 100,
        );
        // A hollow box (a checkbox, a marker ring) is the same line on all four sides.
        const outlined = widths.every((width) => width > 0 && width === widths[0]);
        for (const [index, side] of (["Top", "Right", "Bottom", "Left"] as const).entries()) {
          const width = widths[index] ?? 0;
          if (!(width > 0)) continue;
          const color = parse(style[`border${side}Color` as "borderTopColor"]);
          if (color && color[3] > 0 && !grey(color))
            add(
              element,
              `coloured ${side.toLowerCase()} border ${style[`border${side}Color` as "borderTopColor"]}`,
            );
          const allowed = own || critical ? outlineMax : outlined ? outlineMax : hairline;
          if (width > allowed)
            add(element, `${width}px ${side.toLowerCase()} border (a bar is a block of ink)`);
        }

        if (element instanceof SVGElement && !(element instanceof SVGSVGElement)) {
          for (const property of ["fill", "stroke"] as const) {
            const paint = parse(style[property]);
            if (paint && paint[3] > 0 && !grey(paint))
              add(element, `coloured svg ${property} ${style[property]}`);
          }
        }
      }
      return found;
    },
    {
      hairline: HAIRLINE_PX,
      outlineMax: OUTLINE_MAX_PX,
      tolerance: GREY_TOLERANCE,
      textMax: TEXT_MAX_CHANNEL,
    },
  );
}

/** Throws, naming where and why, when a page in print media would spend ink on styling. */
export async function assertPrintInk(page: Page): Promise<void> {
  const violations = await printInkViolations(page);
  if (violations.length === 0) return;
  const lines = violations
    .slice(0, 12)
    .map((violation) => `  - ${violation.problem}\n    at ${violation.path}`);
  throw new Error(
    `print ink: ${violations.length} violation(s) at ${page.url()}. Paper is ink on white: no ` +
      "colour, no fill (not even grey), no bar, never white on dark " +
      "(.claude/rules/print-ink.md).\n" +
      lines.join("\n") +
      (violations.length > 12 ? `\n  …and ${violations.length - 12} more` : ""),
  );
}
