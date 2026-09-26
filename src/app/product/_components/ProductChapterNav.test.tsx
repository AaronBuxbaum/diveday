// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductChapterNav, revealScrollLeft } from "./ProductChapterNav";

afterEach(cleanup);

/**
 * **The strip has to keep the marked chapter where the reader can see it.**
 *
 * `ProductChapterNav` overflows a phone — five chapters plus the title, every
 * item `whitespace-nowrap shrink-0` — and nothing ever moved its `scrollLeft`.
 * So by the third or fourth chapter the highlight had scrolled off the right
 * edge and a reader saw a strip of names with no mark anywhere in it: a nav
 * that looks like it has stopped tracking them (issue #670).
 *
 * It never reproduced on desktop, where the strip fits inside `max-w-6xl` and
 * every item is on screen at once — and the `product` visual capture
 * photographs the page at rest with `scrollLeft: 0`, where the first chapter is
 * active and already visible. Nothing has ever been in a position to catch it.
 */
const CHAPTERS = [
  { id: "booking", label: "Booking", number: "01" },
  { id: "readiness", label: "Readiness", number: "02" },
  { id: "night-before", label: "Night before", number: "03" },
  { id: "dock", label: "Dock", number: "04" },
  { id: "recap", label: "Recap", number: "05" },
] as const;

/** A strip 300 wide showing a 1000-wide row, currently scrolled to `scrollLeft`. */
function strip(scrollLeft: number) {
  return { scrollLeft, clientWidth: 300, scrollWidth: 1000, boxLeft: 0, boxRight: 300 };
}

describe("revealScrollLeft", () => {
  it("stays put when the chapter is already comfortably on screen", () => {
    expect(revealScrollLeft({ ...strip(0), itemLeft: 100, itemRight: 180 })).toBeNull();
  });

  it("moves the minimum to reveal a chapter off the right edge", () => {
    // Right edge at 340 against a 300-wide strip with 16px of padding: the
    // strip has to move 56px, and not one pixel more. Centring would move 190.
    expect(revealScrollLeft({ ...strip(0), itemLeft: 260, itemRight: 340 })).toBe(56);
  });

  it("moves the minimum to reveal a chapter off the left edge", () => {
    expect(revealScrollLeft({ ...strip(200), itemLeft: -40, itemRight: 30 })).toBe(144);
  });

  it("treats an item touching the padding as needing the nudge", () => {
    // Flush against the edge is not "visible" — the label would be cut by the
    // fade of the next item, which is the state the padding exists for.
    expect(revealScrollLeft({ ...strip(0), itemLeft: 240, itemRight: 300 })).toBe(16);
  });

  it("never scrolls past either end of the strip", () => {
    // Already hard against the left: clamped to 0, which is where it is, so
    // there is nothing to do and it says so rather than scheduling a no-op.
    expect(revealScrollLeft({ ...strip(0), itemLeft: -500, itemRight: -400 })).toBeNull();
    expect(revealScrollLeft({ ...strip(690), itemLeft: 900, itemRight: 1200 })).toBe(700);
  });

  it("aligns the start of a chapter wider than the strip itself", () => {
    // Off both edges at once. Showing its end would hide its number and label,
    // which are the two things a reader is looking for.
    expect(revealScrollLeft({ ...strip(100), itemLeft: -20, itemRight: 400 })).toBe(64);
  });
});

/** jsdom has no layout, so the geometry is supplied and only the wiring is under test. */
function renderNav({ reduced = false }: { reduced?: boolean } = {}) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: reduced && query.includes("reduce") })),
  );
  const scrollTo = vi.fn();
  const view = render(
    <ProductChapterNav ariaLabel="Chapters" title="A day at the shop" chapters={CHAPTERS} />,
  );
  const box = view.container.querySelector("nav > div") as HTMLElement;
  box.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];
  Object.defineProperty(box, "clientWidth", { value: 300, configurable: true });
  Object.defineProperty(box, "scrollWidth", { value: 1000, configurable: true });
  box.getBoundingClientRect = () => ({ left: 0, right: 300 }) as DOMRect;
  return { box, scrollTo };
}

/** Put this chapter's anchor at `left`..`right` relative to the viewport. */
function placeChapter(id: string, left: number, right: number) {
  const anchor = document.querySelector(`[data-chapter="${id}"]`) as HTMLElement;
  anchor.getBoundingClientRect = () => ({ left, right }) as DOMRect;
  return anchor;
}

describe("the chapter strip following its own highlight", () => {
  it("scrolls itself when the reader reaches a chapter that is off screen", () => {
    const { scrollTo } = renderNav();
    placeChapter("dock", 260, 340);

    // Tapping a chapter is the same state change the observer makes.
    fireEvent.click(placeChapter("dock", 260, 340));

    expect(scrollTo).toHaveBeenCalledWith({ left: 56, behavior: "smooth" });
  });

  it("holds still when the chapter is already on screen", () => {
    const { scrollTo } = renderNav();
    fireEvent.click(placeChapter("readiness", 100, 180));

    // The rule that also keeps it from yanking back a reader dragging the strip.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("jumps rather than glides for a reader who asked for less motion", () => {
    const { scrollTo } = renderNav({ reduced: true });
    fireEvent.click(placeChapter("dock", 260, 340));

    // Still follows — the strip is simply already correct when they look.
    expect(scrollTo).toHaveBeenCalledWith({ left: 56, behavior: "auto" });
  });

  it("still marks the chapter it scrolled to", () => {
    renderNav();
    fireEvent.click(placeChapter("dock", 260, 340));

    expect(screen.getByRole("link", { name: /Dock/ })).toHaveAttribute("aria-current", "step");
  });
});

/** Every vertical padding or margin utility in a class list, variants included. */
const blockSpacing = (element: Element) =>
  [...element.classList].filter((token) => /^(?:[\w-]+:)*-?[pm][ytb]-/.test(token));

/**
 * **The active chapter's underline sits on the bar's rule, and its words on
 * the bar's middle** (K-400).
 *
 * The strip padded 4px under its tabs, first for nothing and then as room for
 * the tabs' outset focus ring (a scroll box clips both axes), so the 2px
 * underline and the nav's 1px rule ran 4px apart: two stacked lines where one
 * edge was meant. The tabs take the ring inset now, drawn wholly inside their
 * own box, which needs no room. A first cut then padded the strip's top alone
 * (`pt-2` over 44px tabs), which put the underline on the rule but every
 * label and the strip's title 4px below the bar's middle: 20px of air above
 * the line and 12px below it. So the strip pads nothing and the tabs are the
 * bar's whole height (`min-h-13`, 52px, the bar still 53 with its rule): the
 * underline is the last thing above the rule and the words are centred
 * between the hero's hairline and the rule. The inset ring also cannot reach
 * past the screen's top while the bar is stuck, which the outset one did by a
 * pixel (#1977). jsdom has no layout, so this pins the structure, and the
 * pixel probe measures it.
 */
describe("the chapter strip's underline and rule", () => {
  it("gives the scrolling strip no block padding, so its tabs fill the bar", () => {
    const { box } = renderNav();
    const nav = screen.getByRole("navigation", { name: "Chapters" });
    expect(box.parentElement).toBe(nav);
    expect(nav).toHaveClass("border-b");
    expect(box).toHaveClass("overflow-x-auto", "items-center");
    expect(blockSpacing(box)).toEqual([]);
  });

  it("makes every chapter the bar's whole 52px, with no block padding of its own", () => {
    renderNav();
    for (const chapter of CHAPTERS) {
      const link = screen.getByRole("link", { name: new RegExp(chapter.label) });
      expect(link).toHaveClass("min-h-13", "items-center", "border-b-2");
      expect(link).not.toHaveClass("min-h-11");
      expect(blockSpacing(link)).toEqual([]);
    }
  });

  it("rings every chapter inset, inside the box that scrolls", () => {
    renderNav();
    for (const chapter of CHAPTERS) {
      expect(screen.getByRole("link", { name: new RegExp(chapter.label) })).toHaveClass(
        "focus-visible:focus-ring-inset",
      );
    }
  });

  it("keeps the inset ring 9px clear of a chapter's words from sm, without moving the words", () => {
    // The inset ring fills a tab's outer 3px. At `sm:px-1` its inner edge sat
    // 1px from the "0" of "01" and from the label's last letter. `sm:px-3`
    // leaves 9px, the room every other inset-ring row has; the gaps give back
    // the 16px the padding takes, so the words stand where they stood (40px
    // label to label, 36px title to first chapter).
    const { box } = renderNav();
    const list = box.querySelector("ol");
    expect(box).toHaveClass("sm:gap-x-6");
    expect(list).toHaveClass("sm:gap-x-4");
    for (const chapter of CHAPTERS) {
      const link = screen.getByRole("link", { name: new RegExp(chapter.label) });
      expect(link).toHaveClass("sm:px-3");
      expect(link).not.toHaveClass("sm:px-1");
    }
  });
});

/**
 * **The strip keeps the page's 24px gutter at every width** (K-401). Every
 * section on /product is `px-6`; the strip was `px-4 sm:px-6`, so on a phone
 * its title and last tab ran 8px nearer the screen's edge than the page.
 */
describe("the chapter strip's gutter", () => {
  it("is the page's px-6, with no phone-only narrowing", () => {
    const { box } = renderNav();
    expect(box).toHaveClass("px-6");
    expect([...box.classList].filter((token) => /(^|:)px-/.test(token))).toEqual(["px-6"]);
  });
});
