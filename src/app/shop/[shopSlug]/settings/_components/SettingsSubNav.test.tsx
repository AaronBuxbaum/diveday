// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_GROUPS } from "../settings-destinations";
import { activeSettingsNavKey, SettingsSubNav, type SettingsSubNavCopy } from "./SettingsSubNav";

let pathname = "/shop/blue-mantis/settings";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

afterEach(cleanup);

const COPY: SettingsSubNavCopy = {
  ariaLabel: "Settings sections",
  hub: "Shop settings",
  groupLabels: {
    "your-shop": "Your shop",
    money: "Money",
    "data-integrations": "Data & integrations",
  },
  destinationLabels: {
    team: "Team",
    embed: "Website embed",
    calendar: "Calendar subscriptions",
    whatsapp: "WhatsApp",
    import: "Data import",
    export: "Data export",
  },
};

describe("activeSettingsNavKey", () => {
  const items = [
    { key: "hub", href: "/shop/blue-mantis/settings", label: "Shop settings" },
    { key: "team", href: "/shop/blue-mantis/settings/team", label: "Team" },
  ];

  it("marks the hub on the hub", () => {
    expect(activeSettingsNavKey("/shop/blue-mantis/settings", items)).toBe("hub");
  });

  it("prefers the longer match — every sub-route starts with the hub's own path", () => {
    expect(activeSettingsNavKey("/shop/blue-mantis/settings/team", items)).toBe("team");
  });

  it("is null on a path this nav knows nothing about", () => {
    expect(activeSettingsNavKey("/shop/blue-mantis/orders", items)).toBeNull();
  });
});

describe("the group names, on the hub and off it", () => {
  it("makes each group name an anchor into the page it is standing on", () => {
    // The duplication this replaced: the hub carried this card *and* a JumpNav
    // row of the same three words four lines below it. One vocabulary, one
    // control.
    pathname = "/shop/blue-mantis/settings";
    render(<SettingsSubNav shopSlug="blue-mantis" copy={COPY} />);
    expect(screen.getByRole("link", { name: "Data & integrations" })).toHaveAttribute(
      "href",
      "#data-integrations",
    );
  });

  it("gives a group with no sub-page of its own a row on the hub, because its section exists", () => {
    // Money holds no full-page surface, so off the hub it has nothing to link
    // to and renders nothing. On the hub its section is right there.
    pathname = "/shop/blue-mantis/settings";
    render(<SettingsSubNav shopSlug="blue-mantis" copy={COPY} />);
    expect(screen.getByRole("link", { name: "Money" })).toHaveAttribute("href", "#money");
  });

  it("offers an anchor for every group the hub renders a section for", async () => {
    // The other half of the pair `SettingsPage.test.tsx` holds: that page
    // renders one section per registered group, and this nav links to every
    // one of them. A group added to `SETTINGS_GROUPS` and missed on either
    // side fails one of the two.
    pathname = "/shop/blue-mantis/settings";
    render(<SettingsSubNav shopSlug="blue-mantis" copy={COPY} />);
    const anchors = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter((href) => href?.startsWith("#"));
    expect(anchors).toEqual(SETTINGS_GROUPS.map((group) => `#${group.id}`));
  });

  it("leaves the names as plain captions on a sub-page, where the sections are elsewhere", () => {
    pathname = "/shop/blue-mantis/settings/team";
    render(<SettingsSubNav shopSlug="blue-mantis" copy={COPY} />);
    expect(screen.queryByRole("link", { name: "Data & integrations" })).toBeNull();
    expect(screen.getByText("Data & integrations")).toBeInTheDocument();
    // …and the group with no destinations drops out entirely again.
    expect(screen.queryByText("Money")).toBeNull();
  });

  it("keeps the page you are on out of the link set", () => {
    pathname = "/shop/blue-mantis/settings/team";
    render(<SettingsSubNav shopSlug="blue-mantis" copy={COPY} />);
    expect(screen.queryByRole("link", { name: "Team" })).toBeNull();
    expect(screen.getByText("Team")).toHaveAttribute("aria-current", "page");
  });
});
