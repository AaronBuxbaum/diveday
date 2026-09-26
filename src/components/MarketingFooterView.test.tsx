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
      expect(screen.getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
      expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
      expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
      unmount();
    }
  });

  // Nine 20px-tall words with a square ring on the text, 36px apart when the
  // row wraps on a phone (K-19). Each is a 44px target with the control radius
  // now, and the wrapped rows stack at that 44px pitch rather than 44 + 16.
  // Height alone was not the floor: "About" is 38.8px wide and "Terms" 39.7,
  // so five of the nine were still narrower than 44. Each link carries 8px a
  // side (every link at least 54.8px wide), which is the 16px between words,
  // and the row hangs that padding into the gutter, so the first word stays
  // on x 24 and at lg the last one ends on 1256.
  it("makes every link a 44px target both ways, with a rounded ring", () => {
    render(<MarketingFooterView locale={DEFAULT_DIVER_LOCALE} shopSlug={null} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(9);
    for (const link of links) {
      expect(link).toHaveClass("inline-flex", "min-h-11", "items-center", "rounded-lg", "px-2");
    }
    const row = links[0].parentElement;
    expect(row).toHaveClass("-mx-2", "flex", "flex-wrap");
    // The links' padding is the spacing; a gap on top of it would double it.
    expect(row?.className).not.toMatch(/\bgap-(?:[xy]-)?[1-9]/);
  });

  // Tagline and links need 897px on one row (286 + 595 + a 16px gap). Going
  // one-row at sm put them side by side from 640, so up to about 944 the
  // tagline wrapped and "support@dive.day" dropped alone onto a second line
  // (K-133). From lg the column is 976px wide, which holds the row.
  it("puts the tagline and links on one row only from lg, where they fit", () => {
    const { container } = render(
      <MarketingFooterView locale={DEFAULT_DIVER_LOCALE} shopSlug={null} />,
    );
    const row = container.querySelector("footer > div");
    expect(row).toHaveClass("flex-col", "lg:flex-row", "lg:items-center", "lg:justify-between");
    expect(row?.className).not.toMatch(/\bsm:/);
  });
});
