// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicFindMyBookingPath } from "@/lib/public-routes";
import { PublicShopHeader } from "./PublicShopChrome";

vi.mock("next/navigation", () => ({ usePathname: () => "/s/private-reef" }));
vi.mock("@/components/LanguagePicker", () => ({ LanguagePicker: () => null }));
afterEach(cleanup);
const props = {
  shop: { slug: "private-reef", name: "Private Reef" },
  navAriaLabel: "Shop pages",
  navItems: [{ href: "/s/private-reef", label: "Schedule" }],
  recoveryLabel: "Find my booking",
  locale: "en-US",
  localeLabel: "English",
  languages: [],
  setLocale: async () => {},
  languagePickerCopy: {} as Parameters<typeof PublicShopHeader>[0]["languagePickerCopy"],
};
describe("public shop recovery entry", () => {
  it("keeps a returning diver at the known shop, including an unlisted shop", () => {
    render(<PublicShopHeader {...props} recoveryHref={publicFindMyBookingPath("private-reef")} />);
    expect(screen.getByRole("link", { name: "Find my booking" })).toHaveAttribute(
      "href",
      "/s/private-reef#find-my-booking",
    );
  });
  it("retains the global recovery fallback for a shop without a local form", () => {
    render(<PublicShopHeader {...props} />);
    expect(screen.getByRole("link", { name: "Find my booking" })).toHaveAttribute(
      "href",
      "/find-your-booking",
    );
  });
});
