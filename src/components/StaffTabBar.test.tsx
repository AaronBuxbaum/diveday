// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAFF_DESTINATIONS, type StaffDestinationLabels } from "@/lib/staff-destinations";
import { StaffTabBar } from "./StaffTabBar";

const { usePathname, setMockPathname } = vi.hoisted(() => {
  let current = "/shop/blue-mantis/trips/42";
  return {
    usePathname: vi.fn(() => current),
    setMockPathname: (next: string) => {
      current = next;
    },
  };
});
vi.mock("next/navigation", () => ({ usePathname }));

const PROPS = {
  root: "/shop/blue-mantis",
  gates: {
    waivers: true,
    reports: true,
    team: true,
    settings: true,
  },
  labels: Object.fromEntries(
    STAFF_DESTINATIONS.map((destination) => [destination.id, destination.id]),
  ) as StaffDestinationLabels,
  navAriaLabel: "Staff navigation",
  badgeLabels: { blockers: "Blocked divers" },
  moreLabel: "More",
  groupDailyLabel: "Run the shop",
  groupSetupLabel: "Set up",
};

afterEach(() => {
  cleanup();
  setMockPathname("/shop/blue-mantis/trips/42");
});

describe("StaffTabBar live manifest exception", () => {
  it("removes the dock only on the live manifest and restores it elsewhere", () => {
    const { rerender } = render(<StaffTabBar {...PROPS} />);

    expect(screen.getByRole("navigation", { name: "Staff navigation" })).toBeInTheDocument();

    setMockPathname("/shop/blue-mantis/trips/42/manifest");
    rerender(<StaffTabBar {...PROPS} />);
    expect(screen.queryByRole("navigation", { name: "Staff navigation" })).not.toBeInTheDocument();

    setMockPathname("/shop/blue-mantis/trips/42/prep");
    rerender(<StaffTabBar {...PROPS} />);
    expect(screen.getByRole("navigation", { name: "Staff navigation" })).toBeInTheDocument();

    setMockPathname("/offline-manifest");
    rerender(<StaffTabBar {...PROPS} />);
    expect(screen.getByRole("navigation", { name: "Staff navigation" })).toBeInTheDocument();
  });

  it("keeps the dock as a fixed, safe-area-aware single boundary", () => {
    render(<StaffTabBar {...PROPS} />);

    const nav = screen.getByRole("navigation", { name: "Staff navigation" });
    expect(nav).toHaveClass("fixed", "inset-x-0", "bottom-0", "lg:hidden");

    const surface = nav.firstElementChild;
    expect(surface).toHaveClass("border-t", "border-border", "pb-[env(safe-area-inset-bottom)]");
  });
});
