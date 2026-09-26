// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "@/components/ui/badge";
import { TripPageHeader, TripPageHeaderSkeleton } from "./TripPageHeader";

afterEach(cleanup);

function renderHeader(actions?: ReactNode) {
  return render(
    <TripPageHeader
      trip={{
        title: "Two-Tank Reef — Molasses & French",
        startsAt: new Date("2026-07-21T18:30:00Z"),
        endsAt: new Date("2026-07-21T22:00:00Z"),
      }}
      boardHref="/shop/blue-mantis/trips/trip-1"
      backLabel="Trip"
      locale="en-US"
      timeZone="America/New_York"
      actions={actions}
    />,
  );
}

/**
 * The header the manifest, prep, guests and the printed packet share. Pinned
 * as structure, since jsdom has no layout; the pixel probe re-measures it.
 */
describe("TripPageHeader", () => {
  /**
   * K-196 and K-357: the manifest's 48px ••• sat in a grid cell beside the
   * 16px eyebrow on a phone, 16px under the eyebrow's centre and pushing the
   * title 49px down; from `sm` it moved to the title's row and top-aligned
   * there, 4px above the title's line. The title and the actions are one row
   * now, centred on each other, and the eyebrow keeps a line of its own.
   */
  it("centres the actions on the title's line, and leaves the eyebrow a line of its own", () => {
    renderHeader(<button type="button">More</button>);

    const title = screen.getByRole("heading", { level: 1 });
    const row = title.parentElement;
    expect(row).toHaveClass("flex", "items-center");
    expect(row).toContainElement(screen.getByRole("button", { name: "More" }));
    expect(row).not.toContainElement(screen.getByRole("link", { name: "Trip" }));
    expect(title).toHaveClass("min-w-0", "flex-1");
  });

  it("gives the title its row alone when the surface has no actions", () => {
    renderHeader();

    const title = screen.getByRole("heading", { level: 1 });
    expect(title.parentElement?.children).toHaveLength(1);
  });
});

function loadedHeader() {
  return render(
    <TripPageHeader
      trip={{
        title: "Two-Tank Reef — Molasses & French",
        startsAt: new Date("2026-07-21T18:30:00Z"),
        endsAt: new Date("2026-07-21T22:00:00Z"),
      }}
      boardHref="/shop/blue-mantis/trips/t1"
      backLabel="Trip"
      locale="en-US"
      timeZone="America/New_York"
      badge={<Badge tone="primary">3 spots left</Badge>}
    />,
  ).container;
}

/** The type classes a line box is made of: a size and a leading, at each width. */
const lineType = (element: Element | null) =>
  (element?.className ?? "")
    .split(" ")
    .filter((token) => /^(?:sm:)?(?:text-\[|leading-)/.test(token));

/** The top margins an element sits at, at each width. */
const spacing = (element: Element | null | undefined) =>
  (element?.className ?? "").split(" ").filter((token) => /^(?:sm:)?mt-/.test(token));

/**
 * **`TripPageHeader` drawn as bars** (K-188). `/prep` stood in for it with
 * `ShopPageHeaderSkeleton`, which is the other header: no eyebrow where this one
 * always has its way back, a 44px title line where this one's is 26px on a
 * phone and 38px from `sm`, and a description bar this one never draws. The
 * packing list moved 12px when it landed at 1280.
 */
describe("TripPageHeaderSkeleton", () => {
  it("opens with a bar in the eyebrow's 16px line", () => {
    const loaded = loadedHeader();
    expect(screen.getByRole("link", { name: "Trip" }).closest("span.h-4")).not.toBeNull();
    const skeleton = render(<TripPageHeaderSkeleton />).container.firstElementChild;
    expect(skeleton?.firstElementChild).toHaveClass("h-4");
    expect(loaded.querySelector("header")).toHaveClass("mb-8");
    expect(skeleton).toHaveClass("mb-8");
  });

  it("draws the title's lines in the h1's own line box, spaced as the h1 is", () => {
    loadedHeader();
    const h1 = screen.getByRole("heading", { level: 1 });
    const skeleton = render(<TripPageHeaderSkeleton titleLines={{ base: 2, sm: 1 }} />).container;
    const title = skeleton.firstElementChild?.children[1];
    expect(spacing(title)).toEqual(spacing(h1.parentElement));
    expect(lineType(h1).length).toBeGreaterThanOrEqual(2);
    // Two lines below `sm`, one from it: each is the h1's own line box.
    expect(title?.children).toHaveLength(2);
    for (const line of Array.from(title?.children ?? [])) {
      expect(line).toHaveClass("h-lh", ...lineType(h1));
    }
    expect(title?.children[1]).toHaveClass("sm:hidden");
  });

  it("draws the badge row where the h1's meta row sits, and no description", () => {
    loadedHeader();
    // The h1 shares its row with the surface's actions (K-196, K-357); the
    // meta row is that row's next sibling.
    const meta = screen.getByRole("heading", { level: 1 }).parentElement?.nextElementSibling;
    expect(meta?.textContent).toContain("3 spots left");
    const skeleton = render(<TripPageHeaderSkeleton />).container.firstElementChild;
    const row = skeleton?.children[2];
    expect(spacing(row)).toEqual(spacing(meta));
    // The capacity pill is `Badge`'s `md`: 4px, a 20px line, 4px.
    expect(row?.firstElementChild).toHaveClass("h-7", "rounded-full");
    // Eyebrow, title, the meta row: nothing stands in for a description line.
    expect(skeleton?.children).toHaveLength(3);
  });

  it("leaves the pill out for a header that draws none", () => {
    const skeleton = render(<TripPageHeaderSkeleton badge={false} />).container;
    expect(skeleton.querySelector(".rounded-full")).toBeNull();
  });
});
