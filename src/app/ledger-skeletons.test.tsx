// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { BookingStoryRow } from "@/components/person/rows";
import { ReviewLedger } from "@/components/ShopReviews";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow, ledgerRowBoxClass } from "@/components/ui/ledger";
import { diverTranslator } from "@/i18n/messages";
import { staffTranslator } from "@/i18n/staff-messages";
import PublicBoatLoading from "./s/[shopSlug]/boats/[tripId]/loading";
import PublicReviewsLoading from "./s/[shopSlug]/reviews/loading";
import PublicSiteLoading from "./s/[shopSlug]/sites/[siteSlug]/loading";
import BookingNewLoading from "./shop/[shopSlug]/bookings/new/loading";
import CheckInLoading from "./shop/[shopSlug]/check-in/loading";
import CoursesLoading from "./shop/[shopSlug]/courses/loading";
import DiveSitesLoading from "./shop/[shopSlug]/dive-sites/loading";
import { DiverFileGroupDisclosure } from "./shop/[shopSlug]/divers/[personId]/_components/DiverFileGroupDisclosure";
import DiverProfileLoading from "./shop/[shopSlug]/divers/[personId]/loading";
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
  ["diver record", "DiverStory's BookingStoryRow", DiverProfileLoading],
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

  /**
   * **The archive's skeleton stands the page's own lines** (class 11, K-383).
   * It was written before the five-row rating histogram joined the page, and
   * sized each review 16px short: a 16px star line, a 20px quote and a 16px
   * byline where the page draws a 24px star line, a 24px quote and a 20px
   * byline. The first review arrived 144px below its grey row at 1280, and
   * every one after it 16px further. On a phone the quote wraps to two lines.
   */
  it("draws the histogram's five rows, then each review at its loaded line heights", () => {
    const { container } = render(<PublicReviewsLoading />);
    const histogram = container.querySelector("[data-histogram]");
    expect(histogram).toHaveClass("mt-4", "max-w-sm", "gap-1.5");
    expect(histogram?.children).toHaveLength(5);
    for (const bar of histogram?.children ?? []) expect(bar).toHaveClass("h-5");

    const firstRow = [...container.querySelectorAll("*")].find((element) =>
      element.classList.contains("last:border-b"),
    );
    // Between the aggregate and the first review, as the page draws it.
    expect(histogram?.compareDocumentPosition(firstRow as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const heights = (element: Element) =>
      [...element.classList].filter((token) => /^(?:mt-|h-|sm:hidden$)/.test(token)).join(" ");
    const [stars, quote, byline] = [...(firstRow?.children ?? [])];
    expect(heights(stars)).toBe("h-6");
    expect(heights(quote)).toBe("mt-1.5");
    expect([...quote.children].map(heights)).toEqual(["h-6", "h-6 sm:hidden"]);
    expect(heights(byline)).toBe("mt-1.5 h-5");
  });
});

/**
 * **A diver's record lands on its skeleton's shapes** (pixel-craft class 11).
 * The skeleton still drew the record before its file became one door per
 * group: four label-over-card blocks where the page renders a column of 50px
 * doors, 44px act bars under 48px buttons, 56px story rows under 69px ones,
 * and a 20px meta line where the contact links are 44px targets — so
 * everything under the name dropped about 28px when the record arrived, and
 * the file changed shape entirely.
 */
describe("the diver record's skeleton", () => {
  const box = (element: Element | null | undefined, pattern: RegExp) =>
    [...(element?.classList ?? [])].filter((token) => pattern.test(token)).sort();

  it("draws the file as the doors the record renders, and no card", () => {
    const loaded = render(
      <DiverFileGroupDisclosure id="notes" label="Diver notes" summary="1 note">
        <p>Note body</p>
      </DiverFileGroupDisclosure>,
    ).container.querySelector("summary");
    const door = /^(?:border-y|border-border|p[ytb]-\d)/;
    expect(box(loaded, door)).toEqual(["border-border", "border-y", "py-3"]);
    cleanup();

    const { container } = render(<DiverProfileLoading />);
    expect(container.querySelectorAll(".rounded-panel")).toHaveLength(0);
    const doors = container.querySelectorAll(".border-y");
    expect(doors).toHaveLength(7);
    for (const skeleton of doors) expect(box(skeleton, door)).toEqual(box(loaded, door));
  });

  it("draws the acts at the md buttons' 48px", () => {
    expect(buttonClass().split(" ")).toContain("min-h-12");
    const { container } = render(<DiverProfileLoading />);
    const acts = container.querySelectorAll(".rounded-lg");
    expect(acts).toHaveLength(2);
    for (const act of acts) expect(act).toHaveClass("h-12");
  });

  it("draws the story's rows at the loaded rows' inset", () => {
    const loaded = render(
      <ul>
        <BookingStoryRow
          t={staffTranslator("en-US")}
          date="Tue, Jul 21"
          title="Two-Tank Reef"
          meta="2:30 PM"
          href="/shop/blue-mantis/trips/trip-1"
        />
      </ul>,
    ).container.querySelector("li");
    const inset = /^p[ytb]-/;
    expect(box(loaded, inset)).toEqual(["py-3"]);
    cleanup();

    const { container } = render(<DiverProfileLoading />);
    const rows = [...container.querySelectorAll("*")].filter((element) =>
      element.classList.contains("last:border-b"),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(box(row, inset)).toEqual(box(loaded, inset));
  });
});

/**
 * **The roster lands on its skeleton's shapes** (pixel-craft class 11). The
 * skeleton predated three changes to the page: its four chip bars wrapped to
 * two rows at 390 where `FilterChips` keeps one scrolling row, it drew a 44px
 * search bar and no "Add diver" where the page has a 48px box and a 48px
 * button (a line each on a phone), and its rows stood at 48px where a
 * `LedgerRow` is 52. On a phone the search box a staffer is about to type
 * into jumped 52px up when the roster arrived.
 */
describe("the diver roster's skeleton", () => {
  const box = (element: Element | null | undefined, pattern: RegExp) =>
    [...(element?.classList ?? [])].filter((token) => pattern.test(token)).sort();

  it("keeps the view chips to one row on a phone, wrapping from sm like FilterChips", () => {
    const { container } = render(<DiversLoading />);
    const chips = container.querySelector(".rounded-full")?.parentElement;
    expect(chips).toHaveClass("max-sm:overflow-hidden", "sm:flex-wrap");
    expect(chips).not.toHaveClass("flex-wrap");
  });

  it("draws the md search box and the Add diver beside it at 48px", () => {
    const { container } = render(<DiversLoading />);
    const bars = container.querySelectorAll(".rounded-lg");
    expect(bars).toHaveLength(2);
    for (const bar of bars) expect(bar).toHaveClass("h-12");
    // Add diver takes a line of its own under the full-width box on a phone.
    expect(bars[1]).toHaveClass("max-sm:w-full");
  });

  it("draws every row at a LedgerRow's floor and inset", () => {
    const loaded = render(
      <ul>
        <LedgerRow href="/shop/blue-mantis/divers/person-2" linkLabel="Mira Castellanos">
          Mira Castellanos
        </LedgerRow>
      </ul>,
    ).container.querySelector("li");
    const shape = /^(?:min-h-|p[ytb]-)/;
    expect(box(loaded, shape)).toEqual(["min-h-13", "py-2"]);
    cleanup();

    const { container } = render(<DiversLoading />);
    const rows = [...container.querySelectorAll("*")].filter((element) =>
      element.classList.contains("last:border-b"),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(box(row, shape)).toEqual(box(loaded, shape));
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
