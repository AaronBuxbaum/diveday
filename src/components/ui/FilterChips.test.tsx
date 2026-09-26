// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterChips } from "./FilterChips";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const chips = [
  { key: "all", href: "/shop/blue-mantis/divers", active: false, label: "All divers" },
  {
    key: "needs_attention",
    href: "/shop/blue-mantis/divers?filter=needs_attention",
    active: true,
    label: "Needs attention",
  },
];

describe("FilterChips", () => {
  it("renders every view as a real link, in a labeled nav", () => {
    render(<FilterChips label="Roster views" chips={chips} />);
    const nav = screen.getByRole("navigation", { name: "Roster views" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All divers" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers",
    );
    expect(screen.getByRole("link", { name: "Needs attention" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers?filter=needs_attention",
    );
  });

  it("names the active view for assistive tech, and only that one", () => {
    render(<FilterChips label="Roster views" chips={chips} />);
    expect(screen.getByRole("link", { name: "Needs attention" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: "All divers" })).not.toHaveAttribute("aria-current");
  });

  it("tells a client caller when a chip is followed, so pending state can be dropped", () => {
    // The divers roster hangs its search-debounce cancel here — a keystroke
    // that has not reached the URL yet must not land after the view changes.
    const onNavigate = vi.fn();
    render(<FilterChips label="Roster views" chips={chips} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "All divers" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("leaves the focus ring room above and below where the row scrolls, without moving", () => {
    // Below `sm` the row is a sideways scroll box, and a scroll box clips both
    // axes: with the chips flush top and bottom, the ring's 5px went on both
    // (the pixel probe, every filtered list at 390px). The room is padding the
    // same negative margin takes back, so the row's box does not move.
    render(<FilterChips label="Roster views" chips={chips} className="mb-5" />);
    const nav = screen.getByRole("navigation", { name: "Roster views" });
    const scroller = screen.getByRole("link", { name: "All divers" }).parentElement;
    expect(scroller).toHaveClass("max-sm:overflow-x-auto", "max-sm:py-1.5", "max-sm:-my-1.5");
    // A caller's margin goes on the nav, never on the scroller whose negative
    // margin would override it.
    expect(nav).toHaveClass("mb-5");
    expect(scroller).not.toHaveClass("mb-5");
  });

  /**
   * **Focusing a chip brings it, and its ring, clear of the row's ends** —
   * pixel-craft class 9. The row scrolls on a phone, and the last chip that
   * fits can end a few pixels inside the screen: "Wrecks" ended 3.6px from
   * it at 390, so its ring (5px out) lost 1.5px on the right. The scroll
   * padding is the region a focused chip is scrolled into, so a chip that
   * gets focus is moved a gutter clear of the edge — past the edge fade too.
   */
  it("scrolls a focused chip a gutter and a fade clear of the row's ends", () => {
    render(<FilterChips label="Roster views" chips={chips} />);
    const scroller = screen.getByRole("link", { name: "All divers" }).parentElement;
    expect(scroller).toHaveClass("max-sm:px-4", "max-sm:scroll-px-6");
  });

  it("centers its labels inside the 44px touch floor rather than relying on memory", () => {
    // docs/design/forms-and-controls.md: a min-h floor without flex centering
    // leaves the label at the top of the taller box. Structural, so asserted.
    render(<FilterChips label="Roster views" chips={chips} />);
    const link = screen.getByRole("link", { name: "All divers" });
    expect(link.className).toContain("min-h-11");
    expect(link.className).toContain("inline-flex");
    expect(link.className).toContain("items-center");
  });
});

/**
 * **The row says it scrolls, from the scroll itself** — pixel-craft class 9.
 * The only affordance the phone row had was a last chip peeking in from the
 * right, and whether one peeks depends on the labels: at 390 "Wrecks" ended at
 * 386 and the next chip started at 394, so the row read as complete. A fade at
 * an end says there is more that way. A static mask would also fade the last
 * chip and its focus ring once the row is scrolled to its end, so each fade's
 * length is animated on the row's own scroll: the start fade grows over the
 * first gutter of scroll, the end fade shrinks away over the last, and a row
 * that does not scroll has an inactive timeline and so no fade at all.
 */
describe("the phone row's edge fades", () => {
  const CSS = readFileSync(
    path.join(import.meta.dirname, "..", "..", "app", "globals.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  /** The body of the block opened by the first `prelude {` after `from`, braces balanced. */
  function blockAfter(prelude: string, from = 0): string {
    const at = CSS.indexOf(prelude, from);
    if (at < 0) return "";
    const open = CSS.indexOf("{", at);
    let depth = 0;
    for (let index = open; index < CSS.length; index++) {
      if (CSS[index] === "{") depth++;
      if (CSS[index] === "}" && --depth === 0) return CSS.slice(open + 1, index);
    }
    return "";
  }

  function supportsBlocks(): string[] {
    const blocks: string[] = [];
    let from = 0;
    for (;;) {
      const at = CSS.indexOf("@supports (animation-timeline: scroll())", from);
      if (at < 0) return blocks;
      blocks.push(blockAfter("@supports (animation-timeline: scroll())", at));
      from = at + 1;
    }
  }

  it("marks the phone scroller as the row the fades belong to", () => {
    render(<FilterChips label="Roster views" chips={chips} />);
    expect(screen.getByRole("link", { name: "All divers" }).parentElement).toHaveClass(
      "chip-scroller",
    );
  });

  it("registers both fade lengths as lengths, starting at none", () => {
    for (const name of ["--chip-fade-start", "--chip-fade-end"]) {
      const rule = blockAfter(`@property ${name}`);
      expect(rule, name).toMatch(/syntax:\s*"<length>"/);
      expect(rule, name).toMatch(/initial-value:\s*0(px)?;/);
    }
  });

  it("masks the row with the two lengths, on the row's own inline scroll, on a phone", () => {
    const supports = supportsBlocks().find((block) => block.includes(".chip-scroller"));
    expect(supports).toBeDefined();
    const rule = (supports ?? "").slice((supports ?? "").indexOf(".chip-scroller"));
    // The row's own `max-sm` variant, so the fade and the scroll share one
    // breakpoint (Tailwind compiles it to the same media query as the classes).
    expect(rule).toMatch(/^\.chip-scroller\s*\{\s*@variant max-sm\s*\{/);
    expect(rule).toMatch(/mask-image:[^;]*var\(--chip-fade-start\)[^;]*var\(--chip-fade-end\)/);
    expect(rule).toMatch(/animation-timeline:\s*scroll\(self inline\)/);
  });

  it("fades the end away as the row reaches it, and the start in as it leaves it", () => {
    const end = blockAfter("@keyframes chip-fade-end");
    expect(blockAfter("from", CSS.indexOf("@keyframes chip-fade-end"))).toMatch(
      /--chip-fade-end:\s*[1-9]/,
    );
    expect(end).toMatch(/to\s*\{\s*--chip-fade-end:\s*0(px)?;?\s*\}/);
    const start = blockAfter("@keyframes chip-fade-start");
    expect(start).toMatch(/from\s*\{\s*--chip-fade-start:\s*0(px)?;?\s*\}/);
  });
});

/**
 * **The current view is on screen when the row arrives** — pixel-craft class
 * 10. The phone row always opened at its start, so a view whose chip sits past
 * the screen's edge — "Deleted", the fifth of the roster's chips at 536–620 in
 * a 390px row — loaded with nothing saying which view this is, on a register
 * that drops its list headings because the chip names the view. The row
 * scrolls itself so the current chip starts at its inline-start padding, by
 * setting its own `scrollLeft`: never `scrollIntoView`, which would also
 * scroll the page.
 */
describe("the current chip on a phone", () => {
  const five = ["All divers", "Diving today", "Needs attention", "Waivers", "Deleted"].map(
    (label, index) => ({
      key: `view-${index}`,
      href: `/shop/blue-mantis/divers?view=${index}`,
      active: index === 4,
      label,
    }),
  );

  function stubLayout({
    direction = "ltr",
    scrollWidth = 700,
    active = { left: 536.7, width: 84 },
  }: {
    direction?: "ltr" | "rtl";
    scrollWidth?: number;
    active?: { left: number; width: number };
  } = {}) {
    const isRow = (el: Element) => el.classList.contains("chip-scroller");
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) =>
      isRow(el)
        ? ({
            direction,
            paddingInlineStart: "16px",
            paddingInlineEnd: "16px",
          } as CSSStyleDeclaration)
        : original(el, pseudo),
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return isRow(this) ? 390 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return isRow(this) ? scrollWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (isRow(this)) return DOMRect.fromRect({ x: 0, y: 0, width: 390, height: 56 });
      if (this.getAttribute("aria-current") === "true") {
        return DOMRect.fromRect({ x: active.left, y: 6, width: active.width, height: 44 });
      }
      return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    });
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    return { scrollIntoView, scrollTo };
  }

  const row = () => screen.getByRole("link", { name: "All divers" }).parentElement as HTMLElement;

  it("scrolls the row, and only the row, so the current chip starts at its padding", () => {
    const { scrollIntoView, scrollTo } = stubLayout();
    render(<FilterChips label="Roster views" chips={five} />);
    expect(row().scrollLeft).toBeCloseTo(536.7 - 16);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls toward the start of an RTL row", () => {
    // Mirrored: the chip's start edge is 536.7px from the row's right edge.
    stubLayout({ direction: "rtl", active: { left: 390 - 536.7 - 84, width: 84 } });
    render(<FilterChips label="Roster views" chips={five} />);
    expect(row().scrollLeft).toBeCloseTo(-(536.7 - 16));
  });

  it("leaves a row that does not scroll where it is", () => {
    stubLayout({ scrollWidth: 390 });
    render(<FilterChips label="Roster views" chips={five} />);
    expect(row().scrollLeft).toBe(0);
  });

  it("leaves the row at its start when the current chip is already whole on screen", () => {
    stubLayout({ active: { left: 118.5, width: 116.4 } });
    render(<FilterChips label="Roster views" chips={five} />);
    expect(row().scrollLeft).toBe(0);
  });
});
