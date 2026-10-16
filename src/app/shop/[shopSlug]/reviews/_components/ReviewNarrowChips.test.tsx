// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { ReviewNarrowChips, reviewsPageHref } from "./ReviewNarrowChips";

afterEach(cleanup);
const t = staffTranslator("en-US");
const base = "/shop/blue-mantis/reviews";

/** Fourth UX review, item 30: two narrowings, and paging keeps them. */
describe("narrowing the reviews", () => {
  it("offers All, 3 stars and under, and With a comment, marking the current one", () => {
    const { getByRole } = render(<ReviewNarrowChips base={base} narrow="low" t={t} />);
    expect(getByRole("link", { name: "All" })).toHaveAttribute("href", base);
    const low = getByRole("link", { name: "3 stars and under" });
    expect(low).toHaveAttribute("href", `${base}?show=low`);
    expect(low).toHaveAttribute("aria-current", "true");
    expect(getByRole("link", { name: "With a comment" })).toHaveAttribute(
      "href",
      `${base}?show=comment`,
    );
  });

  it("keeps the narrowing when it pages", () => {
    expect(reviewsPageHref(base, null, 1)).toBe(base);
    expect(reviewsPageHref(base, null, 3)).toBe(`${base}?page=3`);
    expect(reviewsPageHref(base, "comment", 1)).toBe(`${base}?show=comment`);
    expect(reviewsPageHref(base, "low", 2)).toBe(`${base}?show=low&page=2`);
  });
});
