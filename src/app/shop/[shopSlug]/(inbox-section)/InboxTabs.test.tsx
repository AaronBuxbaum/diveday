// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InboxTabs } from "./InboxTabs";

let pathname = "/shop/blue/inbox";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
afterEach(cleanup);

it("tracks the active tab on navigation and back without replacing the tab strip", () => {
  const tabs = [
    { id: "inbox", href: "/shop/blue/inbox", label: "Messages" },
    { id: "reviews", href: "/shop/blue/reviews", label: "Reviews" },
  ];
  const view = render(<InboxTabs label="Inbox" tabs={tabs} />);
  const nav = screen.getByRole("navigation", { name: "Inbox" });
  expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
  pathname = "/shop/blue/reviews";
  view.rerender(<InboxTabs label="Inbox" tabs={tabs} />);
  expect(screen.getByRole("navigation", { name: "Inbox" })).toBe(nav);
  expect(screen.getByRole("link", { name: "Reviews" })).toHaveAttribute("aria-current", "page");
  pathname = "/shop/blue/inbox";
  view.rerender(<InboxTabs label="Inbox" tabs={tabs} />);
  expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
});
