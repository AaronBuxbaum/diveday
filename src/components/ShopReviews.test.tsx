// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonClass, tapTargetLineClass } from "@/components/ui/button";
import type { PublicReview } from "@/db/reviews";
import { diverTranslator } from "@/i18n/messages";
import { ShopReviews, ShopReviewsSkeleton } from "./ShopReviews";

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

/**
 * **The skeleton is as tall as the shelf it stands for** (pixel-craft class
 * 11, K-368). Its bars were under the real line boxes — a 16px star line, a
 * 20px quote, a 16px meta line and a 24px heading — so each row was 97px
 * against 113 loaded at 1280, and the page below it dropped about 36px when
 * the reviews streamed in (104px at 390, where a quote wraps to two lines).
 */
describe("the shelf's skeleton", () => {
  it("draws the heading on the title's 28px line", () => {
    const { container } = render(<ShopReviewsSkeleton />);
    expect(container.querySelector("section > div > div")?.className).toMatch(/\bh-7\b/);
  });

  it("draws each row's lines at the loaded row's line boxes and inset", () => {
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
    const loaded = screen.getByRole("listitem");
    const loadedPad = loaded.className.match(/\bpy-\d+\b/)?.[0];
    cleanup();

    const { container } = render(<ShopReviewsSkeleton />);
    const rows = Array.from(container.querySelectorAll("section > div:nth-child(2) > div"));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(loadedPad).toBeDefined();
      expect(row.className.split(/\s+/)).toContain(loadedPad);
      const [stars, quote, meta] = Array.from(row.children);
      // The stars' line is the row's 24px strut; the quote a 24px `text-base`
      // line, a second one below `sm`; the meta a 20px `text-sm` line.
      expect(stars.className).toMatch(/\bh-6\b/);
      expect(quote.className).toMatch(/\bmt-1\.5\b/);
      expect(quote.querySelectorAll(".h-6")).toHaveLength(2);
      expect(quote.querySelector(".h-6.sm\\:hidden")).not.toBeNull();
      expect(meta.className).toMatch(/\bmt-1\.5\b/);
      expect(meta.className).toMatch(/\bh-5\b/);
    }
  });
});

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

  it("is a 44px target on a 20px line, so the header row stays the heading's height", () => {
    // It was a bare 70.8×20 word (pixel-craft K-237). It is spelled as the
    // storefront's other text doors are ("Follow", the season link), so all
    // four draw one ring.
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
    const door = screen.getByRole("link", { name: "All reviews" });

    expect(door.className).toBe(buttonClass({ variant: "link", size: "sm", flush: true }));
    expect(door.parentElement).toHaveClass(...tapTargetLineClass.split(" "));
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
