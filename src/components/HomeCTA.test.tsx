// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeCTA } from "./HomeCTA";

// A stand-in for Next's real router context: `usePathname()` is what HomeCTA
// keys its preview-reset effect on (see the component's own doc comment).
// `setMockPathname` lets a test simulate a navigation event — including an
// Activity-preserved show/hide cycle, should `cacheComponents: true` be
// re-enabled (it re-fires effects the same way) — without a real Next.js
// router.
const { usePathname, setMockPathname } = vi.hoisted(() => {
  let current = "/";
  return {
    usePathname: vi.fn(() => current),
    setMockPathname: (next: string) => {
      current = next;
    },
  };
});
vi.mock("next/navigation", () => ({ usePathname }));

afterEach(() => {
  cleanup();
  setMockPathname("/");
});

const roleOptions = [
  {
    id: "owner" as const,
    icon: "🤿",
    title: "Owner",
    tryThis: "Try: the schedule board",
    ariaLabel: "Enter demo as owner",
  },
  {
    id: "diver" as const,
    icon: "🌊",
    title: "Diver",
    tryThis: "Try: booking a trip",
    ariaLabel: "Enter demo as diver",
  },
];

const copy = {
  gettingReady: "Getting ready…",
  tryDemo: "Try the demo",
  startTrial: "Start free trial",
  seeLiveSchedule: "See a live schedule",
  enterAsLabel: "Enter as",
};

function homeCTAElement() {
  return (
    <HomeCTA
      enterDemoAction={vi.fn()}
      scheduleHref="/shop/blue-mantis/schedule"
      roleOptions={roleOptions}
      copy={copy}
    />
  );
}

function renderHomeCTA() {
  return render(homeCTAElement());
}

describe("HomeCTA", () => {
  it("shows a role's preview on hover and clears it on mouse leave", async () => {
    renderHomeCTA();

    const ownerButton = screen.getByRole("button", { name: "Enter demo as owner" });
    await userEvent.hover(ownerButton);
    expect(screen.getByText("Try: the schedule board")).toBeInTheDocument();

    await userEvent.unhover(ownerButton);
    expect(screen.queryByText("Try: the schedule board")).not.toBeInTheDocument();
  });

  it("clears a lingering hover preview on a pathname change — an Activity-preserved show/hide cycle must never resurface it", async () => {
    const { rerender } = renderHomeCTA();

    const ownerButton = screen.getByRole("button", { name: "Enter demo as owner" });
    // `userEvent.hover` alone does not always dispatch the corresponding blur
    // /mouseleave before a navigation actually happens in a real browser, so
    // simulate the case where the preview is still showing (no unhover) when
    // the route changes.
    await userEvent.hover(ownerButton);
    expect(screen.getByText("Try: the schedule board")).toBeInTheDocument();

    // Simulate a navigate-away-and-back: the pathname changes and this
    // instance's effects re-run (an Activity re-show, should cacheComponents
    // be re-enabled, behaves like a fresh mount for effects, even though
    // state survived).
    setMockPathname("/pricing");
    rerender(homeCTAElement());

    expect(screen.getByRole("button", { name: "Enter demo as owner" })).toBeInTheDocument();
    expect(screen.queryByText("Try: the schedule board")).not.toBeInTheDocument();
  });
});
