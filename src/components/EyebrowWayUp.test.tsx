// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopPageHeader } from "./ShopPageHeader";

let pathname = "/shop/blue-mantis/settings/team";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(cleanup);

describe("ShopPageHeader's eyebrow (issue #2748)", () => {
  it("links to the parent the URL names, with no href from the page", () => {
    pathname = "/shop/blue-mantis/settings/team";
    render(<ShopPageHeader eyebrow="Settings" title="Team" />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings",
    );
  });

  it("stands unlinked at depth 1", () => {
    pathname = "/shop/blue-mantis/divers";
    render(<ShopPageHeader eyebrow="Shop" title="Divers" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Shop")).toBeInTheDocument();
  });

  it("goes where returnTo says when a query opened the page from elsewhere", () => {
    pathname = "/shop/blue-mantis/divers/new";
    render(
      <ShopPageHeader
        eyebrow="Trip"
        returnTo="/shop/blue-mantis/trips/t-1#add-diver"
        title="New"
      />,
    );
    expect(screen.getByRole("link", { name: "Trip" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/t-1#add-diver",
    );
  });

  it("has no way up on an embedded page", () => {
    pathname = "/s/blue-mantis/trips/t-1";
    render(<ShopPageHeader eyebrow="Blue Mantis" returnTo={null} title="Reef" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
