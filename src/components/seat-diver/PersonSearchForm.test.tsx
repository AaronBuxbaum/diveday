// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonSearchForm } from "./PersonSearchForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/shop/blue-mantis/trips/trip-1/guests",
}));

afterEach(cleanup);

/**
 * **The box and "Add diver" are one row, so they are one size.** The box wore
 * the stacked field's 44px floor beside a 48px `md` primary: centred on one
 * line, it sat 2px inside the button at the top and at the bottom, on every
 * door that seats a returning diver (seventeen trip captures in the pixel
 * probe's `mismatched-controls` cluster, 2026-09-25). The button is `md`
 * because the band is a card body; the box follows it to 48px.
 */
describe("PersonSearchForm", () => {
  it("stands the search box level with the Add diver button", () => {
    render(
      <PersonSearchForm
        query=""
        label="Find a returning diver"
        placeholder="Name, email, or phone"
        addDiverHref="/shop/blue-mantis/divers/new"
        addDiverLabel="Add diver"
      />,
    );
    const box = screen.getByRole("searchbox", { name: "Find a returning diver" });
    const add = screen.getByRole("link", { name: "Add diver" });
    for (const control of [box, add]) {
      expect(control).toHaveClass("min-h-12", "text-base");
    }
    expect(box).not.toHaveClass("min-h-11");
  });
});
