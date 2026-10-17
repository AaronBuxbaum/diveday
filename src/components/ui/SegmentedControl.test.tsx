// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";
import { SEGMENT_CORNER, segmentedGridTrackClass } from "./segmented";

afterEach(cleanup);

const items = [
  { key: "overview", label: "Overview", href: "/shop/reef/trips/1" },
  { key: "guests", label: "Guests", href: "/shop/reef/trips/1/guests" },
  { key: "manifest", label: "Manifest", href: "/shop/reef/trips/1/manifest" },
];

/**
 * The contracts the four converted surfaces rely on: real links a spec can
 * click, a marked current choice, and the dock-test mechanics (target height,
 * centered label, no weight change on selection) that a screenshot can only
 * spot after they have already broken.
 */
describe("SegmentedControl", () => {
  it("is a named navigation of real links", () => {
    render(<SegmentedControl ariaLabel="Trip" items={items} currentKey="overview" />);
    const nav = screen.getByRole("navigation", { name: "Trip" });
    expect(nav.contains(screen.getByRole("link", { name: "Guests" }))).toBe(true);
    expect(screen.getByRole("link", { name: "Manifest" })).toHaveAttribute(
      "href",
      "/shop/reef/trips/1/manifest",
    );
  });

  it("marks the current choice inert by default — a tab bar's 'you are here' is not a destination", () => {
    render(<SegmentedControl ariaLabel="Trip" items={items} currentKey="guests" />);
    expect(screen.queryByRole("link", { name: "Guests" })).toBeNull();
    const current = screen.getByText("Guests");
    expect(current.tagName).toBe("SPAN");
    expect(current).toHaveAttribute("aria-current", "page");
    // The siblings stay plain links, unmarked.
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the current choice clickable for same-page view switches", () => {
    render(
      <SegmentedControl
        ariaLabel="How to read the queue"
        items={items.slice(0, 2)}
        currentKey="overview"
        currentIsLink
        ariaCurrentValue="true"
      />,
    );
    const current = screen.getByRole("link", { name: "Overview" });
    expect(current).toHaveAttribute("aria-current", "true");
    expect(current).toHaveAttribute("href", "/shop/reef/trips/1");
  });

  it("marks nothing current when no key matches — never falsely claims a tab", () => {
    const { container } = render(
      <SegmentedControl ariaLabel="Trip" items={items} currentKey={null} />,
    );
    expect(container.querySelector("[aria-current]")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("floors every option at the 44px dock-test target, centered", () => {
    render(<SegmentedControl ariaLabel="Trip" items={items} currentKey="overview" />);
    for (const label of ["Overview", "Guests", "Manifest"]) {
      const option = screen.getByText(label);
      expect(option).toHaveClass("min-h-11", "inline-flex", "items-center", "justify-center");
    }
  });

  it("raises the floor to 56px targets and 16px labels at boat size", () => {
    render(
      <SegmentedControl ariaLabel="Checkpoint" items={items} currentKey="guests" size="boat" />,
    );
    for (const label of ["Overview", "Guests", "Manifest"]) {
      expect(screen.getByText(label)).toHaveClass("min-h-14", "text-base");
    }
  });

  /**
   * **The floor holds on both axes** (pixel-craft class 7). A target's floor
   * is 44px in width as well as height, and a three-letter label does not
   * reach it: on the public courses page "SDI" measured 43.4×44 and "SSI"
   * 42.3×44 at 390px. The boat size floors its width at its own 56px height,
   * `min-w-14`, so a short label there is a square, not a sliver.
   */
  it("floors every option's width too, so a three-letter label is still a target", () => {
    const short = [
      { key: "sdi", label: "SDI", href: "/s/reef/courses?agency=sdi" },
      { key: "ssi", label: "SSI", href: "/s/reef/courses?agency=ssi" },
    ];
    render(<SegmentedControl ariaLabel="Agency" items={short} currentKey="sdi" />);
    for (const label of ["SDI", "SSI"]) expect(screen.getByText(label)).toHaveClass("min-w-11");
    cleanup();
    render(<SegmentedControl ariaLabel="Agency" items={short} currentKey="sdi" size="boat" />);
    for (const label of ["SDI", "SSI"]) expect(screen.getByText(label)).toHaveClass("min-w-14");
  });

  it("never shifts layout on selection: both states share one weight and size", () => {
    render(<SegmentedControl ariaLabel="Trip" items={items} currentKey="guests" />);
    const current = screen.getByText("Guests");
    const other = screen.getByRole("link", { name: "Overview" });
    for (const option of [current, other]) {
      expect(option).toHaveClass("font-semibold", "text-sm", "whitespace-nowrap");
    }
  });

  it("supports a visible count pill without changing the tab's accessible name", () => {
    render(
      <SegmentedControl
        ariaLabel="Trip"
        items={[
          {
            key: "guests",
            label: (
              <span>
                Guests <span aria-hidden="true">12</span>
              </span>
            ),
            href: "/shop/reef/trips/1/guests",
          },
        ]}
        currentKey={null}
      />,
    );
    expect(screen.getByRole("link", { name: "Guests" })).toBeInTheDocument();
    expect(screen.getByText("12")).toBeVisible();
  });

  /**
   * The phone-width short form (#1320). jsdom applies no media queries, so
   * both words are in the DOM here and the assertion is on the classes that
   * pick between them — `hidden` is `display: none`, which is what keeps the
   * accessible name to whichever one is actually shown.
   */
  it("carries a short form for below sm without renaming the option", () => {
    render(
      <SegmentedControl
        ariaLabel="Roll-call checkpoint"
        items={[
          {
            key: "after_dive_1",
            label: "After dive 1",
            shortLabel: "Dive 1",
            href: "/shop/reef/trips/1/manifest?checkpoint=after_dive_1",
          },
        ]}
        currentKey={null}
      />,
    );
    expect(screen.getByText("After dive 1")).toHaveClass("max-sm:hidden");
    expect(screen.getByText("Dive 1")).toHaveClass("sm:hidden");
    // The wide-viewport name is the one a desktop spec clicks by.
    expect(screen.getByRole("link", { name: /After dive 1/ })).toBeInTheDocument();
  });

  it("leaves an option with no short form as a bare label", () => {
    render(<SegmentedControl ariaLabel="Trip" items={items} currentKey="guests" />);
    // No wrapper element: the option's only child is its own text, so no
    // existing call site grows a span it did not ask for.
    const option = screen.getByRole("link", { name: "Overview" });
    expect(option.childElementCount).toBe(0);
    expect(option).toHaveTextContent("Overview");
  });

  /**
   * **The pill and the options nest in the track's corner** (pixel-craft class
   * 6). Both wore `rounded-lg`, 12px, 5px inside the track's 12px corner, where
   * a concentric curve is 7px: the probe's `nested-corners` flag on the pill
   * and `fill-corners` on the options' hover fill, on every capture that shows
   * a trip's tabs, the manifest's checkpoints or the reports' range. The
   * derivation lives in `segmented.ts`; this pins that every part the
   * component paints takes it, at both sizes.
   */
  it("rounds the pill and every option to the track's corner less its inset", () => {
    for (const size of ["md", "boat"] as const) {
      render(<SegmentedControl ariaLabel="Trip" items={items} currentKey="guests" size={size} />);
      const nav = screen.getByRole("navigation", { name: "Trip" });
      for (const token of segmentedGridTrackClass.split(" ")) expect(nav, size).toHaveClass(token);
      const parts = [
        nav.querySelector('span[aria-hidden="true"]'),
        screen.getByText("Guests"),
        screen.getByRole("link", { name: "Overview" }),
        screen.getByRole("link", { name: "Manifest" }),
      ];
      for (const part of parts) {
        expect(part, size).toHaveClass(SEGMENT_CORNER);
        expect(part, size).not.toHaveClass("rounded-lg");
      }
      cleanup();
    }
  });
});

/**
 * **A track that cannot hold its options on one line lays them on one grid**
 * (pixel-craft class 3). Wrapping a flex row let every line divide its own
 * leftover space, so the counter's departure chips split 221–627 | 631–1059 on
 * the first line and 221–616 | 620–1059 on the second: two lines, two sets of
 * column edges, labels centred at different x.
 *
 * jsdom does no layout, so the boxes are stubbed on the prototype before
 * render. The component measures the track twice — laid on one line at its
 * content's width (`width: max-content`), and at the room it has
 * (`width: 100%`) — so the stub answers by which of the two it was asked.
 */
describe("a track too narrow for one line", () => {
  const five = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => ({
    key: day,
    label: day,
    href: `/shop/reef/check-in?day=${day}`,
  }));

  function renderInRoom(room: number, option = 100) {
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function stubbed(this: Element) {
      const nav = this as HTMLElement;
      const width =
        this.tagName !== "NAV"
          ? option
          : nav.style.width === "max-content"
            ? five.length * option
            : room;
      return {
        left: 0,
        top: 0,
        right: width,
        bottom: 44,
        x: 0,
        y: 0,
        width,
        height: 44,
      } as DOMRect;
    };
    try {
      render(<SegmentedControl ariaLabel="Days" items={five} currentKey="Mon" />);
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
    }
    return screen.getByRole("navigation", { name: "Days" });
  }

  /**
   * **One line is equal widths** (Aaron, 2026-10-03): Money's range tabs sized
   * each option to its label, so the targets jumped from tab to tab. `1fr`
   * columns in a content-width track all take the widest option's width.
   */
  it("keeps one line of equal columns while the options fit", () => {
    const nav = renderInRoom(800);
    expect(nav.style.display).toBe("");
    expect(nav.style.gridTemplateColumns).toBe("");
    expect(nav).toHaveClass("grid", "grid-flow-col", "auto-cols-fr", "w-fit");
    expect(nav).not.toHaveClass("flex");
  });

  it("wraps when every option at the widest one's width would not fit", () => {
    // Five 100px options need 500px on one line; 450px is not enough even
    // though no single option is wider than its share.
    const nav = renderInRoom(450);
    expect(nav).not.toHaveClass("grid-flow-col");
    expect(nav.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))".replace("4", "3"));
  });

  it("lays wrapped options on columns every line shares, balanced across the lines", () => {
    // Three 100px options fit in 300px; five of them then take two lines, and
    // three columns give 3 + 2 rather than 4 + 1.
    const nav = renderInRoom(300);
    expect(nav).toHaveClass("grid");
    expect(nav).not.toHaveClass("flex");
    expect(nav.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    // A grid spans its room; the content-width track's `w-fit` would shrink it.
    expect(nav).not.toHaveClass("w-fit");
  });

  /**
   * **A gridded track still leaves the printed page** (the counter's and the
   * manifest's tracks are chrome, `print:hidden`). The grid's `display` was an
   * inline style, and an inline declaration beats a stylesheet rule that is
   * not `!important`, so every track that had flipped to a grid printed. The
   * display is a class swapped for the track's `flex`, which `print:hidden`
   * outranks as it always did; only the column count is inline.
   */
  it("keeps its display in a class print:hidden outranks, never in an inline style", () => {
    const nav = renderInRoom(300);
    expect(nav.style.display).toBe("");
    expect(nav.getAttribute("style") ?? "").not.toMatch(/display/);
    expect(nav).toHaveClass("print:hidden");
  });

  it("never lays a column narrower than its widest option", () => {
    // 150px options in 300px: two columns, never three that would overlap.
    const nav = renderInRoom(300, 150);
    expect(nav.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("leaves the track's measuring styles behind it", () => {
    const nav = renderInRoom(300);
    expect(nav.style.width).toBe("");
    expect(nav.style.flexWrap).toBe("");
    for (const option of nav.querySelectorAll<HTMLElement>("[data-key]")) {
      expect(option.style.flex).toBe("");
    }
  });
});

/**
 * **The pill's box is snapped to the device pixel grid** (issue 1578).
 *
 * `getBoundingClientRect` answers in fractions and the fraction is not stable:
 * measured three times on one commit under the e2e harness, the same option
 * reported heights of 44.0608, 44.046 and 44.0319 and tops of 4.9696, 4.97702
 * and 4.98404 — text metrics still settling as the run warmed. Written through
 * as inline styles that antialiases the pill's horizontal edges differently
 * every run, and reg-suit reported `prep-by-diver` changed on branches that
 * render nothing on that page: 898 pixels at a maximum channel delta of 47.
 *
 * jsdom does no layout, so the boxes are stubbed on the prototype **before**
 * render — the effect that writes the styles runs on mount, so a stub applied
 * afterwards measures nothing and the test proves nothing. (It was written that
 * way first and passed with the fix removed.) What is under test is the
 * arithmetic between the measurement and the inline style, which is where the
 * fix lives.
 */
describe("the pill's measured box", () => {
  const NAV_BOX = { left: 10.1234, top: 20.5678, width: 300.4321, height: 54.8765 };
  const OPTION_BOX = { left: 84.3369, top: 24.9696, width: 74.3369, height: 44.0608 };

  /**
   * Renders the control with every box stubbed before mount, and the track's
   * border reported through its computed style. jsdom loads no stylesheet, so
   * it answers with no border width at all, which is also what a borderless
   * track would. A test that wants the border to matter has to say how wide it
   * is, and at what device pixel ratio the page is drawn.
   *
   * `clientLeft`/`clientTop` are stubbed to the whole-pixel value a browser
   * would round them to, so a component that read them instead of the
   * computed style would be caught by the fractional-border test below.
   */
  function renderMeasured(trackBorder: number, dpr = 1) {
    const originalRect = Element.prototype.getBoundingClientRect;
    const originalStyle = window.getComputedStyle;
    const originalLeft = Object.getOwnPropertyDescriptor(Element.prototype, "clientLeft");
    const originalTop = Object.getOwnPropertyDescriptor(Element.prototype, "clientTop");
    const originalDpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Element.prototype.getBoundingClientRect = function stubbed(this: Element) {
      const box = this.tagName === "NAV" ? NAV_BOX : OPTION_BOX;
      return { ...box, right: 0, bottom: 0, x: box.left, y: box.top, toJSON: () => box } as DOMRect;
    };
    window.getComputedStyle = ((element: Element, pseudo?: string | null) => {
      const style = originalStyle.call(window, element, pseudo);
      if (element.tagName !== "NAV") return style;
      for (const side of ["borderLeftWidth", "borderTopWidth"]) {
        Object.defineProperty(style, side, { configurable: true, value: `${trackBorder}px` });
      }
      return style;
    }) as typeof window.getComputedStyle;
    const rounded = {
      configurable: true,
      get(this: Element) {
        return this.tagName === "NAV" ? Math.round(trackBorder) : 0;
      },
    };
    Object.defineProperty(Element.prototype, "clientLeft", rounded);
    Object.defineProperty(Element.prototype, "clientTop", rounded);
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: dpr });
    try {
      render(<SegmentedControl ariaLabel="Trip" items={items} currentKey="guests" />);
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
      window.getComputedStyle = originalStyle;
      if (originalLeft) Object.defineProperty(Element.prototype, "clientLeft", originalLeft);
      if (originalTop) Object.defineProperty(Element.prototype, "clientTop", originalTop);
      if (originalDpr) Object.defineProperty(window, "devicePixelRatio", originalDpr);
      else Reflect.deleteProperty(window, "devicePixelRatio");
    }
    const nav = screen.getByRole("navigation", { name: "Trip" });
    return nav.querySelector('span[aria-hidden="true"]') as HTMLElement;
  }

  /** The pill's four edges where the page draws them, read back from what was written. */
  function drawnEdges(pill: HTMLElement, trackBorder: number) {
    const px = (value: string) => {
      expect(value, "every side should have been written").toMatch(/^-?[\d.]+px$/);
      return Number.parseFloat(value);
    };
    const left = NAV_BOX.left + trackBorder + px(pill.style.left);
    const top = NAV_BOX.top + trackBorder + px(pill.style.top);
    return {
      left,
      top,
      right: left + px(pill.style.width),
      bottom: top + px(pill.style.height),
    };
  }

  it("lands every edge on a whole device pixel, never the fraction it measured", () => {
    const edges = drawnEdges(renderMeasured(0), 0);
    for (const [name, value] of Object.entries(edges)) {
      expect(Math.abs(value - Math.round(value)), `${name} was drawn at ${value}`).toBeLessThan(
        1e-9,
      );
    }
    // And snapped to the nearest, not truncated: 84.3369 to 84, 24.9696 to 25.
    expect(Math.round(edges.left)).toBe(84);
    expect(Math.round(edges.top)).toBe(25);
  });

  /**
   * **Each edge is snapped, never the width** (issue #2525). The option runs
   * from 84.3369 to 158.6738; its edges snap to 84 and 159, so the pill is 75
   * wide. Snapping the width on its own (74.3369 → 74) put the right edge a
   * pixel inside the option, and let a width measured either side of .5 move
   * the right edge with nothing else on the page moving:
   * `reports-year-dark-vw-390` flapped by that one column.
   */
  it("snaps the two edges, so the width is whatever lies between them", () => {
    const pill = renderMeasured(0);
    expect(pill.style.width).toBe("75px");
    // 24.9696 to 69.0304: 25 to 69.
    expect(pill.style.height).toBe("44px");
  });

  /**
   * **The edges snap where the page is drawn, not inside the track.** The
   * track starts at x 10.1234, so the option's left edge is 74.2135 inside
   * it. Snapped there, the pill was drawn from 84.1234 (pixel 84) to 159.1234,
   * but the option's right edge, 158.6738, is drawn at 159 only by luck of
   * this fixture: on the prep page's "Group by" the option's own fill ended
   * at 292.4063 (pixel 292) and the track-snapped pill at 292.8125 (pixel
   * 293). The first paint draws the option's fill and the effect draws the
   * pill, so a capture on either side of the effect differed by that column.
   */
  it("snaps the edges in page coordinates, so the pill is drawn on its option's own pixels", () => {
    const pill = renderMeasured(0);
    // 84 - 10.1234 and 25 - 20.5678: the track's fraction stays in the offset.
    expect(Number.parseFloat(pill.style.left)).toBeCloseTo(73.8766, 4);
    expect(Number.parseFloat(pill.style.top)).toBeCloseTo(4.4322, 4);
  });

  /**
   * **The pill sits on its option, not one border-width below and right of
   * it.** `getBoundingClientRect` measures from the track's *border* edge; an
   * absolutely positioned child is placed from its container's *padding* edge.
   * Written straight through, the difference moved the pill by the track's 1px
   * border on both axes — which the probe read as two insets on one corner:
   * on `check-in-checked` at 1280px the first option starts 5px inside the
   * track (x 221) and the pill 6px (x 222), so the pill stood 6px off the
   * track's left edge and 4px off its right, and 1px past its own option.
   */
  it("places the pill from the track's padding edge, inside its border", () => {
    const pill = renderMeasured(1);
    // 84 - 10.1234 - 1 and 25 - 20.5678 - 1.
    expect(Number.parseFloat(pill.style.left)).toBeCloseTo(72.8766, 4);
    expect(Number.parseFloat(pill.style.top)).toBeCloseTo(3.4322, 4);
    // The border moves the offsets; it never moves the drawn edges or the size.
    const edges = drawnEdges(pill, 1);
    expect(edges.left).toBeCloseTo(84, 9);
    expect(edges.top).toBeCloseTo(25, 9);
    expect(pill.style.width).toBe("75px");
    expect(pill.style.height).toBe("44px");
  });

  /**
   * At 125% zoom a 1px border is laid out one device pixel wide, 0.8 CSS px,
   * but `clientTop` rounds it back to 1. The option's top, 24.9696, is 31.21
   * device pixels down the page and snaps to 31: 24.8. Less the track's top
   * and its laid-out 0.8px border that is 3.4322; less a rounded 1px it would
   * be 3.2322, and the pill would be drawn one device pixel above its option.
   */
  it("subtracts the border's laid-out width, fraction and all, at 125% zoom", () => {
    const pill = renderMeasured(0.8, 1.25);
    expect(Number.parseFloat(pill.style.top)).toBeCloseTo(3.4322, 4);
  });
});

/**
 * **The pill follows its options, not only the track** (issue #2525). An
 * option can change width while the track keeps its size (a webfont settling,
 * a label swap), and the track's observer never fires for it: the pill kept
 * the width it measured first, and two runs of one commit drew it a pixel
 * apart.
 */
describe("the pill after layout settles", () => {
  it("observes every option, and re-places the pill when one resizes", () => {
    const observed: Element[] = [];
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe(element: Element) {
          observed.push(element);
        }
        disconnect() {}
        unobserve() {}
      },
    );
    let width = 60;
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function stubbed(this: Element) {
      const box =
        this.tagName === "NAV"
          ? { left: 0, top: 0, width: 300, height: 52 }
          : { left: 10, top: 4, width, height: 44 };
      return { ...box, right: 0, bottom: 0, x: box.left, y: box.top, toJSON: () => box } as DOMRect;
    };
    try {
      render(<SegmentedControl ariaLabel="Trip" items={items} currentKey="guests" />);
      const nav = screen.getByRole("navigation", { name: "Trip" });
      const pill = nav.querySelector('span[aria-hidden="true"]') as HTMLElement;
      expect(pill.style.width).toBe("60px");
      for (const option of nav.querySelectorAll("[data-key]")) expect(observed).toContain(option);

      width = 61;
      act(() => {
        for (const callback of callbacks) callback([], {} as ResizeObserver);
      });
      expect(pill.style.width).toBe("61px");
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
      vi.unstubAllGlobals();
    }
  });

  it("re-places the pill once the page's fonts have loaded", async () => {
    let loaded: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      loaded = resolve;
    });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    let width = 60;
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function stubbed(this: Element) {
      const box =
        this.tagName === "NAV"
          ? { left: 0, top: 0, width: 300, height: 52 }
          : { left: 10, top: 4, width, height: 44 };
      return { ...box, right: 0, bottom: 0, x: box.left, y: box.top, toJSON: () => box } as DOMRect;
    };
    try {
      render(<SegmentedControl ariaLabel="Trip" items={items} currentKey="guests" />);
      const nav = screen.getByRole("navigation", { name: "Trip" });
      const pill = nav.querySelector('span[aria-hidden="true"]') as HTMLElement;
      expect(pill.style.width).toBe("60px");

      width = 62;
      await act(async () => {
        loaded();
        await ready;
      });
      expect(pill.style.width).toBe("62px");
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
      Reflect.deleteProperty(document, "fonts");
    }
  });
});
