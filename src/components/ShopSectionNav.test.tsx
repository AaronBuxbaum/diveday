// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type StaffSection, staffNavSections, staffShopRoot } from "@/lib/staff-destinations";
import { type ShopSectionNavCopy, ShopSidebar, ShopTabBar } from "./ShopSectionNav";

let pathname = "/shop/blue-mantis";

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const root = staffShopRoot("blue-mantis");
const gates = { waivers: true, reports: true, team: true, settings: true };
const items = staffNavSections(gates, { courses: true, gear: true, crew: false });
const sections: Record<StaffSection, string> = {
  today: "Today",
  schedule: "Schedule",
  divers: "Divers",
  inbox: "Inbox",
  money: "Money",
  courses: "Courses",
  gear: "Gear",
  settings: "Settings",
};
const copy: ShopSectionNavCopy = {
  navAriaLabel: "Shop",
  sections,
  more: "More",
  blockedLabel: "blocked",
};

function litRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll("a[aria-current]")].map(
    (a) => `${a.textContent}=${a.getAttribute("aria-current")}`,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  pathname = "/shop/blue-mantis";
});

/**
 * **The lit row follows the page even when the page moved before the nav
 * hydrated** (issue #2252). Today's arrival lookup is a link a staffer taps
 * the moment it paints; the departure it opens commits while the sidebar's
 * own Suspense boundary is still server HTML. That boundary then hydrates
 * against the *new* pathname, and React does not patch attributes a hydrating
 * render disagrees with, so the server's Today stayed lit over the departure,
 * for good.
 */
describe.each([
  ["the sidebar", ShopSidebar],
  ["the phone tab bar", ShopTabBar],
])("%s, hydrated after the page moved on (issue #2252)", (_name, Nav) => {
  it("lights the section the page is in now, not the one the server painted", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const tree = <Nav root={root} gates={gates} items={items} copy={copy} />;
    pathname = "/shop/blue-mantis";
    container.innerHTML = renderToString(tree);
    expect(litRows(container)).toEqual(["Today=page"]);

    pathname = "/shop/blue-mantis/trips/0b5f3b1e-6a43-4c7e-9b1a-6f0e2d4c8a11";
    await act(async () => {
      hydrateRoot(container, tree);
    });

    expect(litRows(container)).toEqual(["Schedule=true"]);
    const today = [...container.querySelectorAll("a")].find((a) => a.textContent === "Today");
    expect(today?.className).toContain("font-medium");
    expect(today?.className).not.toContain("font-semibold");
  });

  it("hydrates a page that did not move without changing a thing", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const tree = <Nav root={root} gates={gates} items={items} copy={copy} />;
    pathname = "/shop/blue-mantis/schedule/board";
    container.innerHTML = renderToString(tree);
    const before = container.innerHTML;
    await act(async () => {
      hydrateRoot(container, tree);
    });
    expect(container.innerHTML).toBe(before);
    expect(litRows(container)).toEqual(["Schedule=page"]);
  });
});
