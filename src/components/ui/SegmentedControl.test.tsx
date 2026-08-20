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
});
