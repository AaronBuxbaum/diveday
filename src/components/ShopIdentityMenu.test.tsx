// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopIdentityMenu, shopInitials } from "./ShopIdentityMenu";

afterEach(() => {
  cleanup();
});

const COPY = {
  settings: "Settings",
  language: "Language",
  signOut: "Sign out",
  signOutConfirm: "Sign out now?",
  signOutPending: "Signing out…",
};

describe("shopInitials", () => {
  it("derives two letters from a multi-word shop name", () => {
    expect(shopInitials("Blue Mantis Divers")).toBe("BM");
    expect(shopInitials("Key Largo Dive Center")).toBe("KL");
  });

  it("derives first two characters from a single-word shop name", () => {
    expect(shopInitials("Oasis")).toBe("OA");
  });

  it("falls back to DD for empty name", () => {
    expect(shopInitials("")).toBe("DD");
    expect(shopInitials("   ")).toBe("DD");
  });
});

describe("ShopIdentityMenu", () => {
  it("renders shop initials in primary square when logoUrl is absent", () => {
    render(
      <ShopIdentityMenu
        shopName="Blue Mantis Divers"
        signOutAction={vi.fn()}
        locale="en-US"
        languages={[{ locale: "en-US", label: "English (US)" }]}
        setLocaleAction={vi.fn()}
        copy={COPY}
      />,
    );

    expect(screen.getByText("BM")).toBeInTheDocument();
    expect(screen.getByText("Blue Mantis Divers")).toBeInTheDocument();
  });

  it("renders custom logo image when logoUrl is provided", () => {
    const { container } = render(
      <ShopIdentityMenu
        shopName="Blue Mantis Divers"
        logoUrl="https://blob.example/logo.webp"
        signOutAction={vi.fn()}
        locale="en-US"
        languages={[{ locale: "en-US", label: "English (US)" }]}
        setLocaleAction={vi.fn()}
        copy={COPY}
      />,
    );

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://blob.example/logo.webp");
    expect(screen.queryByText("BM")).toBeNull();
  });

  /**
   * **Settings is the reason this menu is the shop's name** (ADR
   * 20260919-one-idea, slice 23b). It is the one place with no hour in it, so
   * the bar's three times have no pill for it and this is its door. It lived
   * here once and left when the nav's "More" groups arrived — a second door
   * would have been a duplicate control — and there is no nav now.
   */
  it("opens on Settings for a reader who may see it", async () => {
    render(
      <ShopIdentityMenu
        shopName="Blue Mantis Divers"
        settingsHref="/shop/blue-mantis/settings"
        signOutAction={vi.fn()}
        locale="en-US"
        languages={[{ locale: "en-US", label: "English (US)" }]}
        setLocaleAction={vi.fn()}
        copy={COPY}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Blue Mantis Divers/ }));
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings",
    );
  });

  it("is absent, not disabled, for a reader who may not open it", async () => {
    // The same rule every gated place follows (ADR
    // 20260724-role-gated-surfaces-hide-not-explain): a captain is not shown a
    // row that refuses them.
    render(
      <ShopIdentityMenu
        shopName="Blue Mantis Divers"
        signOutAction={vi.fn()}
        locale="en-US"
        languages={[{ locale: "en-US", label: "English (US)" }]}
        setLocaleAction={vi.fn()}
        copy={COPY}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Blue Mantis Divers/ }));
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    // …and the reader's own half of the menu is still there.
    expect(screen.getByText("Language")).toBeInTheDocument();
  });
});
