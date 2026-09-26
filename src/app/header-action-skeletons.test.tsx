// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import PublicSiteLoading from "./s/[shopSlug]/sites/[siteSlug]/loading";
import CoursesLoading from "./shop/[shopSlug]/courses/loading";
import DiveSiteLoading from "./shop/[shopSlug]/dive-sites/[id]/loading";
import DiveSitesLoading from "./shop/[shopSlug]/dive-sites/loading";
import OrdersLoading from "./shop/[shopSlug]/orders/loading";
import NewOrderLoading from "./shop/[shopSlug]/orders/new/loading";
import StaffReviewsLoading from "./shop/[shopSlug]/reviews/loading";
import ScheduleBoardLoading from "./shop/[shopSlug]/schedule/board/loading";
import ExportLoading from "./shop/[shopSlug]/settings/export/loading";

afterEach(cleanup);

/**
 * **A page whose header has doors stands them in on a phone** (docs/design/
 * pixel-craft.md, class 11: 0px of shift on load).
 *
 * Below `sm`, `ShopPageHeader` stacks its actions under the title, 20px down,
 * each door grown to the row. Skeletons drew only the title block, so every
 * one of these pages dropped its body by the doors' height and gap when it
 * landed — 68px on Reviews and on a public dive site (K-86). Each skeleton
 * below stands in for a header that carries actions in its usual state,
 * counted in rows as the captures at 390px show them: the board's three doors
 * wrap to two rows for an owner, the rest fit one.
 */
const HEADERS_WITH_DOORS: [name: string, rows: number, Skeleton: ComponentType][] = [
  ["public dive site", 1, PublicSiteLoading],
  ["staff reviews", 1, StaffReviewsLoading],
  ["courses", 1, CoursesLoading],
  ["dive-site library", 1, DiveSitesLoading],
  ["dive-site editor", 1, DiveSiteLoading],
  ["orders", 1, OrdersLoading],
  ["new order", 1, NewOrderLoading],
  ["data export", 1, ExportLoading],
  ["schedule board", 2, ScheduleBoardLoading],
];

describe("a skeleton standing in for a header with actions", () => {
  it.each(HEADERS_WITH_DOORS)(
    "draws the %s header's doors below sm, %i row(s) of them",
    (_name, rows, Skeleton) => {
      const { container } = render(<Skeleton />);
      const doors = [...container.querySelectorAll(".sm\\:hidden")].filter(
        (band) =>
          band.children.length > 0 &&
          [...band.children].every((row) => row.classList.contains("h-12")),
      );
      expect(doors).toHaveLength(1);
      expect(doors[0].children).toHaveLength(rows);
    },
  );
});
