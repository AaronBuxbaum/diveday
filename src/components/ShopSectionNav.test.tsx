// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type StaffDestinationGates,
  staffNavSections,
  staffShopRoot,
} from "@/lib/staff-destinations";
import { type ShopSectionNavCopy, ShopSidebar, ShopTabBar } from "./ShopSectionNav";

const location = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => location.pathname }));

const root = staffShopRoot("blue-mantis");
const gates: StaffDestinationGates = { waivers: true, reports: true, team: true, settings: true };
const props = {
  root,
  gates,
  items: staffNavSections(gates, { courses: false, gear: false, crew: true }),
  copy: {
    navAriaLabel: "Main",
    sections: {
      today: "Today",
      schedule: "Schedule",
      divers: "Divers",
      inbox: "Inbox",
      money: "Money",
      courses: "Courses",
      gear: "Gear",
      settings: "Settings",
    },
    more: "More",
    blockedLabel: "blocked",
  } satisfies ShopSectionNavCopy,
};

afterEach(() => {
  document.body.innerHTML = "";
});

function link(container: HTMLElement, name: string): HTMLAnchorElement {
  const found = [...container.querySelectorAll("a")].find((a) => a.textContent?.includes(name));
  if (!found) throw new Error(`no ${name} link`);
  return found;
}

/**
 * **A click before the sidebar wakes up must not leave it pointing at the
 * page the staffer left** (issue #2273).
 *
 * The sidebar streams in under its own `<Suspense>`, so a staffer quick off
 * the mark opens a departure before it hydrates. It then hydrates against the
 * *new* address over HTML the server wrote for the *old* one, and React does
 * not patch an attribute that differs at hydration: the board's link kept
 * `aria-current="page"` on the departure for as long as the page stayed open,
 * and a click from Today to Divers kept Today lit.
 */
describe.each([
  ["the sidebar", ShopSidebar],
  ["the tab bar", ShopTabBar],
])("%s, hydrated after the address moved", (_, Nav) => {
  it("says where the staffer is now, not where the server last saw them", async () => {
    location.pathname = `${root}/schedule/board`;
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Nav {...props} />);
    document.body.append(container);
    expect(link(container, "Schedule").getAttribute("aria-current")).toBe("page");

    location.pathname = `${root}/trips/departure-1`;
    await act(async () => {
      hydrateRoot(container, <Nav {...props} />, { onRecoverableError: () => {} });
    });

    expect(link(container, "Schedule").getAttribute("aria-current")).toBe("true");
  });

  it("moves the light when the staffer left for another section", async () => {
    location.pathname = root;
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Nav {...props} />);
    document.body.append(container);

    location.pathname = `${root}/divers`;
    await act(async () => {
      hydrateRoot(container, <Nav {...props} />, { onRecoverableError: () => {} });
    });

    expect(link(container, "Divers").getAttribute("aria-current")).toBe("page");
    expect(link(container, "Today").hasAttribute("aria-current")).toBe(false);
  });
});
