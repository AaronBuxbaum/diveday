// @vitest-environment jsdom

import { act } from "@testing-library/react";
import { Activity, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_SWITCHES_ON } from "@/lib/shop-features";
import {
  type StaffDestinationGates,
  staffNavSections,
  staffShopRoot,
} from "@/lib/staff-destinations";
import { LIVE_REFRESH_INTERVAL_MS, LiveRefresh } from "./LiveRefresh";
import { type ShopSectionNavCopy, ShopSidebar, ShopTabBar } from "./ShopSectionNav";

const location = vi.hoisted(() => ({ pathname: "" }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useRouter: () => router,
}));

const root = staffShopRoot("blue-mantis");
const gates: StaffDestinationGates = {
  waivers: true,
  reports: true,
  team: true,
  settings: true,
  boats: true,
  tripTags: true,
  safetyChecklist: true,
};
const props = {
  root,
  gates,
  items: staffNavSections(gates, { courses: false, gear: false, switches: ALL_SWITCHES_ON }),
  copy: {
    navAriaLabel: "Main",
    sections: {
      today: "Today",
      schedule: "Schedule",
      divers: "Divers",
      inbox: "Inbox",
      money: "Money",
      safety: "Safety",
      diveSites: "Dive sites",
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

  // The e2e harness waits on this before clicking a row (#2332).
  it("says it is hydrated only once React has redrawn it", async () => {
    location.pathname = root;
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Nav {...props} />);
    document.body.append(container);
    const nav = () => container.querySelector("nav[data-staff-nav]");
    expect(nav()?.hasAttribute("data-hydrated")).toBe(false);

    await act(async () => {
      hydrateRoot(container, <Nav {...props} />);
    });

    expect(nav()?.getAttribute("data-hydrated")).toBe("true");
  });
});

describe("the tab bar, on keyboard focus", () => {
  it("scrolls the focused tab the least distance into its rail (issue 3433)", async () => {
    location.pathname = root;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      createRoot(container).render(<ShopTabBar {...props} />);
    });

    await act(async () => {
      link(container, "Inbox").focus();
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });
});

it("keeps More open when its first click hydrates the tab bar", async () => {
  location.pathname = root;
  const container = document.createElement("div");
  container.innerHTML = renderToString(<ShopTabBar {...props} />);
  document.body.append(container);
  await act(async () => {
    hydrateRoot(container, <ShopTabBar {...props} />);
    container.querySelector("button")?.click();
  });
  expect(container.querySelector("button")).toHaveAttribute("aria-expanded", "true");
});

it("updates More's active section when the address moves before hydration", async () => {
  location.pathname = root;
  const container = document.createElement("div");
  container.innerHTML = renderToString(<ShopTabBar {...props} />);
  document.body.append(container);
  location.pathname = `${root}/safety-checklist`;
  await act(async () => {
    hydrateRoot(container, <ShopTabBar {...props} />, { onRecoverableError: () => {} });
  });
  expect(container.querySelector("button.text-primary, button .text-primary")).not.toBeNull();
});

describe("More stays where a tap put it", () => {
  async function openMore() {
    location.pathname = root;
    const container = document.createElement("div");
    document.body.append(container);
    const reactRoot = createRoot(container);
    await act(async () => {
      reactRoot.render(<ShopTabBar {...props} />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[aria-expanded]")?.click();
    });
    return { container, reactRoot };
  }

  it("survives the page re-reading itself with fresh props", async () => {
    const { container, reactRoot } = await openMore();
    await act(async () => {
      reactRoot.render(<ShopTabBar {...props} items={[...props.items]} blocked={3} />);
    });
    expect(container.querySelector("[aria-expanded]")).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps More open when Activity replays effects, then closes on a changed address", async () => {
    location.pathname = root;
    const container = document.createElement("div");
    document.body.append(container);
    const reactRoot = createRoot(container);
    const effects = vi.fn();
    function EffectProbe() {
      useEffect(() => {
        effects();
      }, []);
      return null;
    }
    const draw = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <EffectProbe />
        <ShopTabBar {...props} />
      </Activity>
    );
    await act(async () => {
      reactRoot.render(draw("visible"));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[aria-expanded]")?.click();
    });
    await act(async () => {
      reactRoot.render(draw("hidden"));
    });
    await act(async () => {
      reactRoot.render(draw("visible"));
    });
    expect(effects).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[aria-expanded]")).toHaveAttribute("aria-expanded", "true");
    await act(async () => {
      reactRoot.render(draw("hidden"));
    });
    location.pathname = `${root}/safety-checklist`;
    await act(async () => {
      reactRoot.render(draw("visible"));
    });
    expect(effects).toHaveBeenCalledTimes(3);
    expect(container.querySelector("[aria-expanded]")).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      reactRoot.unmount();
    });
  });

  it("keeps More open while the visible page refreshes with fresh props", async () => {
    vi.useFakeTimers();
    location.pathname = root;
    const container = document.createElement("div");
    document.body.append(container);
    const reactRoot = createRoot(container);
    const draw = (blocked: number) => (
      <>
        <ShopTabBar
          {...props}
          blocked={blocked}
          copy={{ ...props.copy, more: blocked ? "More refreshed" : "More" }}
        />
        <LiveRefresh />
      </>
    );
    router.refresh.mockImplementation(() => reactRoot.render(draw(3)));
    try {
      await act(async () => {
        reactRoot.render(draw(0));
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>("[aria-expanded]")?.click();
      });
      await act(async () => {
        vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS);
      });
      expect(router.refresh).toHaveBeenCalledTimes(1);
      expect(container.querySelector("[aria-expanded]")).toHaveAttribute("aria-expanded", "true");
      expect(link(container, "Money")).toBeVisible();
      expect(container).toHaveTextContent("More refreshed");
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      const trigger = container.querySelector<HTMLButtonElement>("[aria-expanded]");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).toHaveFocus();
      await act(async () => {
        trigger?.click();
      });
      await act(async () => {
        document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    } finally {
      await act(async () => {
        reactRoot.unmount();
      });
      router.refresh.mockReset();
      vi.useRealTimers();
    }
  });

  it("closes when the address moves", async () => {
    const { container, reactRoot } = await openMore();
    location.pathname = `${root}/safety-checklist`;
    await act(async () => {
      reactRoot.render(<ShopTabBar {...props} />);
    });
    expect(container.querySelector("[aria-expanded]")).toHaveAttribute("aria-expanded", "false");
  });
});
