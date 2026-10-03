// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { BookingStoryRow } from "@/components/person/rows";
import { ReviewLedger } from "@/components/ShopReviews";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { LedgerRow, ledgerRowBoxClass } from "@/components/ui/ledger";
import { diverTranslator } from "@/i18n/messages";
import { staffTranslator } from "@/i18n/staff-messages";
import PublicReviewsLoading from "./s/[shopSlug]/reviews/loading";
import PublicSiteLoading from "./s/[shopSlug]/sites/[siteSlug]/loading";
import BookingNewLoading from "./shop/[shopSlug]/bookings/new/loading";
import CoursesLoading from "./shop/[shopSlug]/courses/loading";
import DiveSitesLoading from "./shop/[shopSlug]/dive-sites/loading";
import { DiverFileGroupDisclosure } from "./shop/[shopSlug]/divers/[personId]/_components/DiverFileGroupDisclosure";
import DiverProfileLoading from "./shop/[shopSlug]/divers/[personId]/loading";
import DiversLoading from "./shop/[shopSlug]/divers/loading";
import GearLoading from "./shop/[shopSlug]/gear/loading";
import InboxLoading from "./shop/[shopSlug]/inbox/loading";
import TodayLoading from "./shop/[shopSlug]/loading";
import { OrdersLedger } from "./shop/[shopSlug]/orders/_components/OrdersLedger";
import OrdersLoading from "./shop/[shopSlug]/orders/loading";
import PromosLoading from "./shop/[shopSlug]/promos/loading";
import ReportsLoading from "./shop/[shopSlug]/reports/loading";
import RequestsLoading from "./shop/[shopSlug]/requests/loading";
import StaffReviewsLoading from "./shop/[shopSlug]/reviews/loading";
import StaffingLoading from "./shop/[shopSlug]/staffing/loading";
import CheckInLoading from "./shop/[shopSlug]/trips/[id]/check-in/loading";
import { SignatureLog } from "./shop/[shopSlug]/waivers/_components/SignatureLog";
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

  // One act: Book a departure. Contact details is a file door, not a button
  // beside it (ADR 20261001-logbook, decision 2).
  it("draws the one act at the md button's 48px", () => {
    expect(buttonClass().split(" ")).toContain("min-h-12");
    const { container } = render(<DiverProfileLoading />);
    const acts = container.querySelectorAll(".rounded-lg");
    expect(acts).toHaveLength(1);
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

/** The row floor (`min-h-*`) a loaded `LedgerRow` of `size` draws. */
function loadedRowFloor(size: "md" | "lg" = "md"): string {
  const { container } = render(
    <ul>
      <LedgerRow size={size}>x</LedgerRow>
    </ul>,
  );
  const floor = [...(container.querySelector("li")?.classList ?? [])].find((token) =>
    token.startsWith("min-h-"),
  );
  cleanup();
  return floor ?? "";
}

function hairlineRows(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("*")].filter((element) =>
    element.classList.contains("last:border-b"),
  );
}

/**
 * **The register's skeleton is the register's height** (class 11, K-430). Its
 * rows kept the 48px `LedgerRow` read until 2026-09-02, 4px short of every
 * loaded row; every on-the-wall row drew an act the wall's rows do not carry;
 * and four chips on one line stood in for a band that wraps to two at 1280.
 */
describe("the gear register's skeleton", () => {
  it("draws every row at the loaded row's floor", () => {
    const floor = loadedRowFloor();
    const rows = hairlineRows(render(<GearLoading />).container);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toHaveClass(floor);
  });

  it("draws no act on the on-the-wall rows, whose only trailing mark is the door's chevron", () => {
    const { container } = render(<GearLoading />);
    const groups = container.querySelectorAll(".animate-pulse > div:last-child > div");
    expect(groups).toHaveLength(2);
    const wallRows = hairlineRows(groups[1] as HTMLElement);
    expect(wallRows.length).toBeGreaterThan(0);
    for (const row of wallRows) expect(row.querySelector(".rounded-lg")).toBeNull();
    for (const row of hairlineRows(groups[0] as HTMLElement)) {
      expect(row.querySelector(".rounded-lg")).not.toBeNull();
    }
  });

  it("lays its chips out as FilterChips does: one scrolling line on a phone, wrapping from sm", () => {
    const { container } = render(<GearLoading />);
    const band = container.querySelector(".rounded-full")?.parentElement;
    expect(band).toHaveClass("flex", "gap-2", "max-sm:overflow-hidden", "sm:flex-wrap");
    expect(band).not.toHaveClass("flex-wrap");
    // A shop's full register: All, nine kinds and the service-due view, which
    // wrap to a second line at 1280 as the loaded band does.
    expect(band?.children).toHaveLength(11);
  });
});

/**
 * **Staff reviews' skeleton rows are the review row's stack** (class 11,
 * K-436). Fixed `h-20` and `h-14` bars stood in for rows that are a star line,
 * a quote and a meta line in the ledger's 12px inset — 97px and 69–94px at
 * 1280 — and ignored the phone, where `LedgerRow stacked` drops the row's act
 * to a 44px line of its own; every row under the first slid down on arrival.
 */
describe("the staff reviews' skeleton", () => {
  it("draws each row as ReviewLedgerRow's LedgerRow: stacked, 12px inset, the row floor", () => {
    const floor = loadedRowFloor();
    const rows = hairlineRows(render(<StaffReviewsLoading />).container);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row).toHaveClass(floor, "py-3", "max-sm:flex-wrap");
      expect(row).not.toHaveClass("h-20");
      expect(row).not.toHaveClass("h-14");
    }
  });

  it("stacks stars, quote and meta, the waiting quote at the 16px type it is set in", () => {
    const rows = hairlineRows(render(<StaffReviewsLoading />).container);
    const stack = (row: Element) =>
      [...(row.firstElementChild?.children ?? [])].map((bar) =>
        [...bar.classList].filter((token) => /^(h|mt)-/.test(token)).join(" "),
      );
    expect(stack(rows[0])).toEqual(["h-6", "mt-1 h-6", "mt-1 h-4"]);
    expect(stack(rows[5])).toEqual(["h-6", "mt-1 h-5", "mt-1 h-4"]);
  });

  it("stands in for the row's act with a 44px bar that drops to its own line on a phone", () => {
    const rows = hairlineRows(render(<StaffReviewsLoading />).container);
    for (const row of rows) {
      const act = row.lastElementChild;
      expect(act).toHaveClass("max-sm:basis-full", "max-sm:justify-end");
      expect(act?.firstElementChild).toHaveClass("h-11");
    }
  });
});

/**
 * **The orders skeleton's rows are as tall as the rows they stand in for**
 * (class 11; K-390). A `LedgerRow` at `md` is 52px — it read 48 until
 * 2026-09-02 — and the skeleton kept drawing `h-12`, so a nine-order day moved
 * 36px when it arrived. The height from `sm` is read off the row itself, so
 * the next change to the floor fails here rather than on screen.
 *
 * Below `sm` the loaded row is taller than its floor: the diver and what they
 * bought stack as two `text-base` lines (24 + 2 + 24) inside the row's `py-2`
 * and its 1px rule, 67px (hairlines 571 to 638 at 390). A row whose detail
 * wraps is 91px, which a skeleton cannot know about; one line is the shape
 * every row with a detail has at least.
 */
describe("the orders skeleton's rows", () => {
  it("are the height of the LedgerRow they stand in for, on a phone and from sm", () => {
    const loaded = render(
      <ul>
        <LedgerRow>Amara Osei</LedgerRow>
      </ul>,
    ).container.querySelector("li");
    const floor = [...(loaded?.classList ?? [])].find((token) => /^min-h-\d+$/.test(token));
    expect(floor).toBeDefined();
    cleanup();
    const rows = [...render(<OrdersLoading />).container.querySelectorAll("*")].filter((element) =>
      element.classList.contains("last:border-b"),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toHaveClass(`sm:${floor}`.replace("min-", ""));
      expect(row).toHaveClass("h-16.75");
    }
  });

  /**
   * A day's header is `GroupLabel`'s one `text-xs` line, 16px, and its rows
   * start the list's `mt-2.5` under it: 26px. The skeleton drew `h-3` bars in
   * `pb-2`, 20px, so every day group landed 6px lower than it was drawn.
   */
  it("stands each day's header in the loaded label's line and the list's gap", () => {
    render(
      <OrdersLedger
        days={[
          {
            key: "2026-08-27",
            label: "Today · Thu, Aug 27",
            meta: "1 order · $60.00",
            rows: [
              {
                id: "order-1",
                href: "/shop/blue-mantis/orders/order-1",
                linkLabel: "Amara Osei, $60.00",
                diver: "Amara Osei",
                detail: "Two-Tank Reef",
                status: null,
                amount: "$60.00",
              },
            ],
          },
        ]}
      />,
    );
    const listGap = [...(document.querySelector("ul")?.classList ?? [])].find((token) =>
      /^mt-/.test(token),
    );
    expect(listGap).toBeDefined();
    cleanup();
    const pulse = render(<OrdersLoading />).container.querySelector(".animate-pulse");
    const headers = [...(pulse?.querySelectorAll("*") ?? [])]
      .filter((element) => element.nextElementSibling?.classList.contains("last:border-b"))
      .filter((element) => !element.classList.contains("last:border-b"));
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header).toHaveClass("h-4", `${listGap}`.replace(/^mt-/, "mb-"));
      expect(header).not.toHaveClass("pb-2");
    }
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

/**
 * **The waivers skeleton draws the page the log lands on** (class 11). The page
 * stopped showing the release editor at rest ("The ledger leads; the editor is
 * a door", waivers/page.tsx): it is one 48px "Edit the release" button, while
 * the skeleton kept the open editor's 426px card, so "Signed records" landed
 * 378px higher than its bar at 1280.
 *
 * And its rows are the loaded rows. A loaded row is the `<li>`'s 1px rule over
 * a summary with a 51px floor (`min-h-12.75`): 52px from `sm` up, where it is
 * one line, and 65px below `sm`, where the departure takes a line of its own
 * (8 + the name's 24 + 4 + the departure's 20 + 8, under the rule). A skeleton
 * row of one fixed-height line (`h-13`) was 52px at every width, so on a phone
 * each row landed 13px taller than its bar and the second day's label moved
 * 39px on arrival. The skeleton draws the same two boxes in the same grammar,
 * so it matches at every width, the group's last row and its closing rule
 * included.
 */
describe("the waivers skeleton", () => {
  it("draws the closed release door as one 48px bar, and no editor card", () => {
    const { container } = render(<WaiversLoading />);
    const card = sectionCardClass({ padding: "lg" }).split(" ");
    const cards = [...container.querySelectorAll("*")].filter((element) =>
      card.every((token) => element.classList.contains(token)),
    );
    expect(cards).toHaveLength(0);
    const main = container.querySelector("main > div");
    // The header, then the door, then the log.
    const door = main?.children[1];
    expect(door).toHaveClass("h-12", "rounded-lg");
    expect(door?.children).toHaveLength(0);
  });

  it("draws each log row in the loaded row's grammar: one 52px line from sm up, two lines on a phone", () => {
    // The row's height is set by these, on the summary under the rule.
    const HEIGHT = ["flex", "flex-wrap", "min-h-12.75", "gap-y-1", "py-2"];
    const loaded = render(
      <SignatureLog
        entries={[
          {
            id: "signed-1",
            personId: "person-1",
            personName: "Grace Mensah",
            tripId: "trip-1",
            tripTitle: "Two-Tank Reef",
            tripStartsAt: new Date("2026-08-27T11:00:00Z"),
            status: "completed",
            signedAt: new Date("2026-08-28T02:41:00Z"),
            templateVersion: 4,
            guardian: null,
            integrity: "valid",
            flaggedPrompts: [],
          },
        ]}
        shopSlug="blue-mantis"
        locale="en-US"
        timezone="America/Cancun"
        t={staffTranslator("en-US")}
      />,
    ).container;
    const summary = loaded.querySelector("summary");
    expect(summary).toHaveClass(...HEIGHT);
    const [name, trip] = [...(summary?.children ?? [])];
    expect(name).toHaveClass("max-sm:me-auto");
    expect(trip).toHaveClass("max-sm:order-last", "max-sm:basis-full");
    cleanup();

    const { container } = render(<WaiversLoading />);
    const rows = [...container.querySelectorAll("*")].filter((element) =>
      element.classList.contains("last:border-b"),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // The rule is the row's box; the height is the summary-shaped box in it.
      expect(row.children).toHaveLength(1);
      expect(row).not.toHaveClass("h-13");
      expect(row).not.toHaveClass("min-h-13");
      const line = row.firstElementChild;
      expect(line).toHaveClass(...HEIGHT);
      expect(line).not.toHaveClass("h-13");
      const [nameBar, tripBar, timeBar] = [...(line?.children ?? [])];
      // The name's 24px line: a 16px bar and 4px each side. It pushes the time
      // to the first line's end on a phone, as the name does.
      expect(nameBar).toHaveClass("h-4", "my-1", "max-sm:me-auto");
      // The departure's 20px `text-sm` line, a full-width line of its own on a
      // phone, as the departure is.
      expect(tripBar).toHaveClass("h-4", "my-0.5", "max-sm:order-last", "max-sm:basis-full");
      expect(timeBar).toHaveClass("h-4", "shrink-0");
    }
  });
});
