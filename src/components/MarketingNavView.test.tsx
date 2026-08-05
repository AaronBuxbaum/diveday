// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { MarketingNavView } from "./MarketingNavView";

/**
 * The nav's CTA slot is the only thing on a marketing page that changes with
 * the session, so it is the only thing worth pinning here: signed out it sells
 * the trial, signed in it points home. Signing out left this bar entirely —
 * it is staff-header work — and the assertions below are what stop it coming
 * back the next time somebody needs "somewhere to put a session control".
 */
function renderNav(props: Partial<Parameters<typeof MarketingNavView>[0]> = {}) {
  return render(
    <MarketingNavView
      shopSlug={null}
      locale={DEFAULT_DIVER_LOCALE}
      hideTrialCta={false}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe("MarketingNavView", () => {
  it("sells the trial and offers sign-in to a signed-out visitor", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "Start a trial" })).toHaveAttribute(
      "href",
      expect.stringContaining("/onboard"),
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to shop" })).not.toBeInTheDocument();
  });

  it("points a signed-in staffer at their own shop instead of a trial", () => {
    renderNav({ shopSlug: "blue-mantis" });
    expect(screen.getByRole("link", { name: "Go to shop" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis",
    );
    expect(screen.queryByRole("link", { name: "Start a trial" })).not.toBeInTheDocument();
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

  it("keeps the way back to the shop on /onboard, which only hides the trial pitch", () => {
    renderNav({ shopSlug: "blue-mantis", hideTrialCta: true });
    expect(screen.getByRole("link", { name: "Go to shop" })).toBeInTheDocument();
  });

  it("hides the trial CTA on /onboard for a signed-out visitor", () => {
    renderNav({ hideTrialCta: true });
    expect(screen.queryByRole("link", { name: "Start a trial" })).not.toBeInTheDocument();
  });
});
