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
