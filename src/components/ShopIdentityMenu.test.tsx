// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopIdentityMenu, shopInitials } from "./ShopIdentityMenu";

afterEach(() => {
  cleanup();
});

const COPY = {
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
});
