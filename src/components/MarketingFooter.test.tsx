// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { MarketingFooterView } from "./MarketingFooterView";

afterEach(cleanup);

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
});
