// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterChips } from "./FilterChips";

afterEach(cleanup);

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
