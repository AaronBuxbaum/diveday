// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

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

  it("writes whole device pixels, never the fraction it measured", () => {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function stubbed(this: Element) {
      const box = this.tagName === "NAV" ? NAV_BOX : OPTION_BOX;
      return { ...box, right: 0, bottom: 0, x: box.left, y: box.top, toJSON: () => box } as DOMRect;
    };
    try {
      render(<SegmentedControl ariaLabel="Trip" items={items} currentKey="guests" />);
      const nav = screen.getByRole("navigation", { name: "Trip" });
      const pill = nav.querySelector('span[aria-hidden="true"]') as HTMLElement;

      // Every written value is whole at dpr 1 — and none of them is empty, or
      // the assertion below would be satisfied by a pill that measured nothing.
      for (const [name, value] of Object.entries({
        left: pill.style.left,
        top: pill.style.top,
        width: pill.style.width,
        height: pill.style.height,
      })) {
        expect(value, `${name} should have been written`).not.toBe("");
        expect(value, `${name} was ${value}, not a whole pixel at dpr 1`).toMatch(/^-?\d+px$/);
      }
      // And snapped to the nearest, not truncated: 84.3369 - 10.1234 = 74.2135.
      expect(pill.style.left).toBe("74px");
      expect(pill.style.height).toBe("44px");
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });
});
