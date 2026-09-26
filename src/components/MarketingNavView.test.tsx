// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { MarketingNavView } from "./MarketingNavView";

/**
 * The nav's CTA slot is the only thing on a marketing page that changes with
 * the session, so it is the only thing worth pinning here: signed out it
 * pitches the demo (the funnel's lead door, docs/product/marketing.md — "The
 * two doors, and which one leads"), signed in it points home. Signing out
 * left this bar entirely — it is staff-header work — and the assertions
 * below are what stop it coming back the next time somebody needs "somewhere
 * to put a session control".
 */
function renderNav(props: Partial<Parameters<typeof MarketingNavView>[0]> = {}) {
  return render(
    <MarketingNavView
      shopSlug={null}
      locale={DEFAULT_DIVER_LOCALE}
      hideCta={false}
      // A stub: `enterDemoAction` itself imports `better-auth`, unloadable under
      // jsdom, which is exactly why `demoAction` is a prop rather than an
      // import here (see MarketingNavView's own file comment).
      demoAction={() => {}}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe("MarketingNavView", () => {
  it("pitches the demo and offers sign-in to a signed-out visitor", () => {
    renderNav();
    expect(screen.getByRole("button", { name: "Try the live demo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to shop" })).not.toBeInTheDocument();
  });

  it("points a signed-in staffer at their own shop instead of the demo", () => {
    renderNav({ shopSlug: "blue-mantis" });
    expect(screen.getByRole("link", { name: "Go to shop" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis",
    );
    expect(screen.queryByRole("button", { name: "Try the live demo" })).not.toBeInTheDocument();
    // Nobody signed in needs to be told where to sign in.
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("never offers to sign anyone out", () => {
    for (const shopSlug of [null, "blue-mantis"]) {
      const { unmount } = renderNav({ shopSlug });
      expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/sign out/i)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("keeps the way back to the shop on /onboard, which only hides the demo pitch", () => {
    renderNav({ shopSlug: "blue-mantis", hideCta: true });
    expect(screen.getByRole("link", { name: "Go to shop" })).toBeInTheDocument();
  });

  it("hides the demo CTA on /onboard for a signed-out visitor", () => {
    renderNav({ hideCta: true });
    expect(screen.queryByRole("button", { name: "Try the live demo" })).not.toBeInTheDocument();
  });

  // The first row's height is its tallest child. With the CTA gone it used to
  // fall to the 24px wordmark, so the logo sat 12px higher on /dive than on /
  // (K-178); the home link's own 48px floor now holds the row at the CTA's height.
  // Wordmark, five links, the CTA and two gaps need about 669px on one row in
  // en-US and about 837 in es-ES, whose links and "Probar la demo en vivo" are
  // longer. Switching to one row at sm squeezed the links into a wrapped block
  // between 640 and 716 (K-88); switching at md still did that in es-ES from
  // 768 to about 884. lg's 976px holds both, so up to lg the header keeps its
  // two phone rows, links included at their phone padding, and no class in
  // the bar, compact or not, may switch at sm or md.
  it("switches to one row at lg, where every diver locale fits", () => {
    for (const props of [
      {},
      { shopSlug: "blue-mantis" },
      { compactMobile: true, hideCta: true },
      { compactMobile: true, hideCta: true, shopSlug: "blue-mantis" },
    ]) {
      const { unmount } = renderNav(props);
      const nav = screen.getByRole("navigation");
      expect(nav).toHaveClass("flex-wrap", "lg:flex-nowrap");
      const links = screen.getByRole("link", { name: "Product" }).parentElement;
      expect(links).toHaveClass("order-3", "basis-full", "lg:order-none", "lg:basis-auto");
      for (const element of [nav, ...nav.querySelectorAll("*")]) {
        expect(element.getAttribute("class") ?? "").not.toMatch(/(^|\s)(max-)?(sm|md):/);
      }
      unmount();
    }
  });

  // /onboard's compact bar (the wordmark alone, 52px) exists so that page never
  // opens on the two-row header. It ended at sm, so once the one-row switch
  // moved up, /onboard and the closed door drew the full two rows, 132px, on a
  // landscape phone. The compact bar now holds for as long as the full header
  // would be two rows.
  it("keeps /onboard's compact bar for as long as the header would be two rows", () => {
    for (const shopSlug of [null, "blue-mantis"]) {
      const { container, unmount } = renderNav({ compactMobile: true, hideCta: true, shopSlug });
      expect(container.querySelector("header")).toHaveClass(
        "border-b-0",
        "lg:border-b",
        "lg:border-border",
      );
      const nav = screen.getByRole("navigation");
      expect(nav).toHaveClass("max-lg:h-[52px]", "max-lg:flex-nowrap", "max-lg:py-0");
      expect(screen.getByRole("link", { name: "Product" }).parentElement).toHaveClass(
        "max-lg:hidden",
      );
      if (shopSlug) {
        expect(screen.getByRole("link", { name: "Go to shop" })).toHaveClass("max-lg:hidden");
      }
      unmount();
    }
  });

  // The compact /onboard bar was `max-sm:px-5`, so its wordmark sat 4px left
  // of every other marketing header's and of the page column under it (K-245).
  it("keeps the compact phone bar on the same 24px gutter as every header", () => {
    renderNav({ compactMobile: true, hideCta: true });
    const nav = screen.getByRole("navigation");
    expect(nav).toHaveClass("px-6");
    expect(nav.className).not.toMatch(/(^|\s)max-[a-z0-9]+:px-/);
  });

  // With no CTA after it, the last link's own `lg:px-3` padding left its word
  // 13px short of the gutter the footer and the CTA end on (K-512). The row
  // hangs that padding into the gutter only when the CTA slot is empty.
  it("hangs the last link's padding into the gutter only when no CTA follows", () => {
    const rowOf = () => screen.getByRole("link", { name: "Product" }).parentElement;

    const empty = renderNav({ hideCta: true });
    expect(rowOf()).toHaveClass("lg:-me-3");
    empty.unmount();

    for (const props of [
      {},
      { shopSlug: "blue-mantis" },
      { shopSlug: "blue-mantis", hideCta: true },
    ]) {
      const { unmount } = renderNav(props);
      expect(rowOf()).not.toHaveClass("lg:-me-3");
      unmount();
    }
  });

  it("keeps the first row at the CTA's 48px when hideCta drops the CTA", () => {
    renderNav({ hideCta: true });
    expect(screen.getByRole("link", { name: "DiveDay." })).toHaveClass("min-h-12");
  });
});
