// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { MarketingFooterView } from "./MarketingFooterView";

afterEach(cleanup);

/**
 * The last link in the row is the only thing in the footer that changes with
 * the session — signed out it points at sign-in, signed in it points home,
 * mirroring the nav's CTA slot (see MarketingNavView.test.tsx). Everything
 * else is the same for everyone, which is what makes `MarketingFooterFallback`'s
 * signed-out render safe to paint into the static shell: only that one slot can
 * be wrong for a moment. The "unchanged either way" case below keeps it true.
 */
describe("MarketingFooterView", () => {
  it("offers sign-in to an anonymous visitor", () => {
    render(<MarketingFooterView locale={DEFAULT_DIVER_LOCALE} shopSlug={null} />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("link", { name: "Go to shop" })).not.toBeInTheDocument();
  });

  it("sends a signed-in staffer back to their own shop", () => {
    render(<MarketingFooterView locale={DEFAULT_DIVER_LOCALE} shopSlug="blue-mantis" />);

    expect(screen.getByRole("link", { name: "Go to shop" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis",
    );
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("leaves the rest of the footer unchanged either way", () => {
    for (const shopSlug of [null, "blue-mantis"]) {
      const { unmount } = render(
        <MarketingFooterView locale={DEFAULT_DIVER_LOCALE} shopSlug={shopSlug} />,
      );

      expect(screen.getByRole("link", { name: "Product" })).toHaveAttribute("href", "/product");
      expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
      expect(screen.getByRole("link", { name: "Switch" })).toHaveAttribute("href", "/switching");
      expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
      unmount();
    }
  });
});
