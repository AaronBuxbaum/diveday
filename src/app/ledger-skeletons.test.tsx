// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewLedger } from "@/components/ShopReviews";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { diverTranslator } from "@/i18n/messages";
import PublicBoatLoading from "./s/[shopSlug]/boats/[tripId]/loading";
import PublicReviewsLoading from "./s/[shopSlug]/reviews/loading";
import PublicSiteLoading from "./s/[shopSlug]/sites/[siteSlug]/loading";
import BookingNewLoading from "./shop/[shopSlug]/bookings/new/loading";
import CheckInLoading from "./shop/[shopSlug]/check-in/loading";
import CoursesLoading from "./shop/[shopSlug]/courses/loading";
import DiveSitesLoading from "./shop/[shopSlug]/dive-sites/loading";
import DiversLoading from "./shop/[shopSlug]/divers/loading";
import GearLoading from "./shop/[shopSlug]/gear/loading";
import InboxLoading from "./shop/[shopSlug]/inbox/loading";
import TodayLoading from "./shop/[shopSlug]/loading";
import OrdersLoading from "./shop/[shopSlug]/orders/loading";
import PromosLoading from "./shop/[shopSlug]/promos/loading";
import ReportsLoading from "./shop/[shopSlug]/reports/loading";
import RequestsLoading from "./shop/[shopSlug]/requests/loading";
import StaffReviewsLoading from "./shop/[shopSlug]/reviews/loading";
import StaffingLoading from "./shop/[shopSlug]/staffing/loading";
import WaiversLoading from "./shop/[shopSlug]/waivers/loading";

afterEach(cleanup);

/**
 * **A skeleton's rows sit where the loaded rows' rules will** (docs/design/
 * pixel-craft.md, class 11: 0px of shift on load).
 *
 * Every `LedgerRow` keeps 8px of room each side of the column, and its rules
 * run 8px past the column with it (`FILL_ROOM`, src/components/ui/ledger.tsx).
 * A skeleton row drawn on the column moved every hairline 8px outward at the
 * moment the list arrived. Each skeleton below stands in for a list of ledger
 * rows (named beside it), so every hairline row it draws — every element that
 * closes its list with `last:border-b`, the ledger's signature — has to carry
 * the ledger's box.
 */
const SKELETONS: [name: string, loadedBy: string, Skeleton: ComponentType][] = [
  ["orders", "OrdersLedger", OrdersLoading],
  ["divers", "DiverList", DiversLoading],
  ["gear", "GearRegisterLedger", GearLoading],
  ["courses", "CourseRoster", CoursesLoading],
  ["inbox", "InboxRow", InboxLoading],
  ["booking-new", "DeparturePicker", BookingNewLoading],
  ["dive sites", "SiteLibraryLedger", DiveSitesLoading],
  ["reports", "DepartureLedger", ReportsLoading],
  ["promos", "PromoLedger", PromosLoading],
  ["check-in", "CounterQueueRow", CheckInLoading],
  ["requests", "RequestLedgerRow", RequestsLoading],
  ["waivers", "SignatureLog", WaiversLoading],
  ["staffing", "StaffCredentials", StaffingLoading],
  ["staff reviews", "ReviewLedgerRow", StaffReviewsLoading],
  ["Today", "DaySpine's station rows", TodayLoading],
  ["public dive site", "the site's departures", PublicSiteLoading],
  ["public reviews", "ShopReviews", PublicReviewsLoading],
  ["public boat", "BoatLine and the page's two door rows", PublicBoatLoading],
];

/**
 * **A public review stands in the 16px its skeleton draws** (class 11). The
 * row took the ledger's own inset at 12px (`pad="lg"`) while both of its
 * skeletons — the reviews page's and the schedule's shelf — kept the `py-4` it
 * had always had, so each review arrived 8px shorter than the grey row it
 * replaced. The rows keep their 16px (`pad="xl"`).
 */
describe("the public reviews' rows", () => {
  it("keep the vertical inset their loading skeleton draws", () => {
    const inset = (element: Element | null) =>
      [...(element?.classList ?? [])].filter((token) => /^p[ytb]-/.test(token));
    const { container } = render(
      <ReviewLedger
        reviews={[
          {
            id: "review-1",
            rating: 5,
            comment: "The swim-throughs were the best of the week.",
            isStandout: false,
            reviewer: "Priya",
            tripTitle: "Two-Tank Reef",
            divedAt: new Date("2026-08-26T12:00:00Z"),
            publishedAt: new Date("2026-08-26T18:00:00Z"),
          },
        ]}
        locale="en-US"
        timezone="America/New_York"
        t={diverTranslator("en-US")}
      />,
    );
    const loaded = inset(container.querySelector("li"));
    expect(loaded).toEqual(["py-4"]);
    cleanup();
    const skeleton = render(<PublicReviewsLoading />).container;
    const rows = [...skeleton.querySelectorAll("*")].filter((element) =>
      element.classList.contains("last:border-b"),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(inset(row)).toEqual(loaded);
  });
});

describe("a loading skeleton standing in for ledger rows", () => {
  it.each(SKELETONS)(
    "draws every %s hairline row on the ledger box its loaded list (%s) draws",
    (_name, _loadedBy, Skeleton) => {
      const { container } = render(<Skeleton />);
      const rows = [...container.querySelectorAll("*")].filter((element) =>
        element.classList.contains("last:border-b"),
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).toHaveClass(...ledgerRowBoxClass.split(" "));
      }
    },
  );
});
