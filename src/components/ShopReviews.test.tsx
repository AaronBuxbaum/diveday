// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicReview } from "@/db/reviews";
import { diverTranslator } from "@/i18n/messages";
import { ShopReviews } from "./ShopReviews";

/**
 * The storefront's reviews shelf (ADR 20260827-clearwater-surface-language,
 * decision 8). The pin that matters most is a silence: the aggregate belongs to
 * the hero now, and saying it again down here would be principle 9's "one
 * shared fact, said once" broken on the page that argues for it.
 */
const t = diverTranslator("en-US");

afterEach(cleanup);

function review(n: number, overrides: Partial<PublicReview> = {}): PublicReview {
  return {
    id: `review-${n}`,
    rating: 5,
    comment: `Quote ${n}.`,
    isStandout: false,
    reviewer: `Diver ${n}`,
    tripTitle: "Two-Tank Reef",
    divedAt: new Date("2026-08-26T12:00:00Z"),
    publishedAt: new Date("2026-08-26T18:00:00Z"),
    ...overrides,
  };
}

const AGGREGATE = { count: 83, average: 4.3, suppressedCount: 0 };

describe("the shelf's door", () => {
  it("leads to the shop's own review archive", () => {
    render(
      <ShopReviews
        aggregate={AGGREGATE}
        reviews={[review(1)]}
        shopSlug="blue-mantis"
        locale="en-US"
        timezone="America/New_York"
        t={t}
      />,
    );

    expect(screen.getByRole("link", { name: "All reviews" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/reviews",
    );
  });

  it("carries two quotes and hands the rest to the archive", () => {
    render(
      <ShopReviews
        aggregate={AGGREGATE}
        reviews={[review(1), review(2), review(3), review(4)]}
        shopSlug="blue-mantis"
        locale="en-US"
        timezone="America/New_York"
        t={t}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("Quote 3.")).not.toBeInTheDocument();
  });
});

describe("what the shelf does not say", () => {
  it("never restates the aggregate the hero already carries", () => {
    render(
      <ShopReviews
        aggregate={AGGREGATE}
        reviews={[review(1)]}
        shopSlug="blue-mantis"
        locale="en-US"
        timezone="America/New_York"
        t={t}
      />,
    );

    expect(screen.queryByText(/83 reviews/)).not.toBeInTheDocument();
    expect(screen.queryByText(/every one from a diver/)).not.toBeInTheDocument();
  });

  it("renders nothing at all for a shop with no published reviews", () => {
    const { container } = render(
      <ShopReviews
        aggregate={{ count: 0, average: null, suppressedCount: 0 }}
        reviews={[]}
        shopSlug="blue-mantis"
        locale="en-US"
        timezone="America/New_York"
        t={t}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the stars", () => {
  it("fill in --accent as drawn marks on this public page", () => {
    const { container } = render(
      <ShopReviews
        aggregate={AGGREGATE}
        reviews={[review(1)]}
        shopSlug="blue-mantis"
        locale="en-US"
        timezone="America/New_York"
        t={t}
      />,
    );

    expect(container.querySelector(".text-accent")).not.toBeNull();
    expect(container.querySelector(".text-warning")).toBeNull();
    expect(container.textContent).not.toContain("★");
  });
});
