// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { MarketingNavView } from "./MarketingNavView";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
function renderNav(props: Partial<Parameters<typeof MarketingNavView>[0]> = {}) {
  return render(
    <MarketingNavView
      shopSlug={null}
      locale={DEFAULT_DIVER_LOCALE}
      demoAction={() => {}}
      {...props}
    />,
  );
}
afterEach(cleanup);

describe("MarketingNavView", () => {
  it("keeps demo access beside the mobile menu and discloses secondary links", () => {
    renderNav();
    expect(screen.getByRole("button", { name: "Try the live demo" })).toBeInTheDocument();
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Product" })).toHaveAttribute("href", "/product");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });

  it("dismisses with Escape and returns focus to the disclosure", () => {
    renderNav();
    const menu = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(menu);
    screen.getByRole("link", { name: "Pricing" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu).toHaveFocus();
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  it("dismisses on an outside pointer and when following a destination", () => {
    renderNav();
    const menu = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(menu);
    fireEvent.pointerDown(document.body);
    expect(menu).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("link", { name: "Product" }));
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  it("returns signed-in staff to their own shop without another demo or sign-in door", () => {
    renderNav({ shopSlug: "blue-mantis" });
    expect(screen.getByRole("link", { name: "Go to shop" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis",
    );
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try the live demo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("keeps the compact onboarding header and localized menu words", () => {
    const { container } = renderNav({ compactMobile: true, locale: "es-ES" });
    expect(screen.getByRole("button", { name: "Menú" })).toBeInTheDocument();
    expect(container.querySelector("header")).toHaveClass("border-b-0");
    expect(screen.getByRole("button", { name: "Probar la demo en vivo" })).toBeInTheDocument();
  });
});
