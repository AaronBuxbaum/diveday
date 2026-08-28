// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeNavIndex, PublicShopNav, type PublicShopNavItem } from "./PublicShopNav";

let pathname = "/s/blue-mantis";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

afterEach(cleanup);

const ITEMS: PublicShopNavItem[] = [
  { href: "/s/blue-mantis", label: "Schedule" },
  { href: "/s/blue-mantis/courses", label: "Courses" },
];

describe("activeNavIndex", () => {
  it("marks the schedule on the schedule itself", () => {
    expect(activeNavIndex("/s/blue-mantis", ITEMS)).toBe(0);
  });

  it("keeps a departure's booking page under the schedule it was found on", () => {
    expect(activeNavIndex("/s/blue-mantis/trips/abc-123", ITEMS)).toBe(0);
  });

  it("prefers the longer match, so a course page is Courses and not the schedule", () => {
    // The bug a plain prefix test would ship: every public path starts with
    // the schedule's own href.
    expect(activeNavIndex("/s/blue-mantis/courses", ITEMS)).toBe(1);
    expect(activeNavIndex("/s/blue-mantis/courses/open-water-diver", ITEMS)).toBe(1);
    expect(activeNavIndex("/s/blue-mantis/courses/advanced-open-water-diver", ITEMS)).toBe(1);
  });

  it("never lights up another shop's tab on a sibling slug", () => {
    // "/s/blue-mantis-north" starts with "/s/blue-mantis" as a *string*; the
    // segment boundary is what stops it.
    expect(activeNavIndex("/s/blue-mantis-north", ITEMS)).toBe(-1);
  });

  it("reports no match rather than guessing when nothing fits", () => {
    expect(activeNavIndex("/s/other-shop", ITEMS)).toBe(-1);
  });
});

describe("PublicShopNav", () => {
  it("gives exactly one link aria-current, on the page being read", () => {
    pathname = "/s/blue-mantis/courses/open-water-diver";
    render(<PublicShopNav ariaLabel="Shop pages" items={ITEMS} />);

    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Schedule" })).not.toHaveAttribute("aria-current");
  });

  it("keeps every destination label at 16px, at every width", () => {
    // Design principle 2 counts a control's own label as critical text with a
    // 16px floor, and `check:critical-text` already holds the staff dock to it.
    // This shipped as `text-sm sm:text-base` behind a comment arguing that
    // navigation is not critical text, which is an argument against a written
    // rule rather than a way of changing one. The pixels came out of padding
    // instead, so the responsive halves that remain are `px-*`, never `text-*`.
    pathname = "/s/blue-mantis";
    render(<PublicShopNav ariaLabel="Shop pages" items={ITEMS} />);

    for (const label of ["Schedule", "Courses"]) {
      const link = screen.getByRole("link", { name: label });
      expect(link.className).toContain("text-base");
      expect(link.className).not.toMatch(/(?:^|\s|:)text-sm\b/);
      // The 44px target the dock test asks for, still bought separately from
      // the type size.
      expect(link.className).toContain("min-h-11");
    }
  });

  it("renders only the destinations it was handed — no Courses tab for a shop with none", () => {
    pathname = "/s/blue-mantis";
    render(<PublicShopNav ariaLabel="Shop pages" items={[ITEMS[0]]} />);

    expect(screen.getByRole("navigation", { name: "Shop pages" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Courses" })).toBeNull();
  });
});
