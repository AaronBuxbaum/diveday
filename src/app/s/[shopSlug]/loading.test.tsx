// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DAY_LABEL_COLUMN_CLASS,
  DAY_NUMERAL_CLASS,
  WEEK_ROW_BOX_CLASS,
  WEEK_TIME_RAIL_CLASS,
  WeekLedger,
} from "./_components/WeekLedger";
import TripsLoading from "./loading";

afterEach(cleanup);

/** Every element under `root` that wears every class in `classes`. */
function wearing(root: Element, classes: string): Element[] {
  const tokens = classes.split(" ");
  return Array.from(root.querySelectorAll("*")).filter((element) =>
    tokens.every((token) => element.classList.contains(token)),
  );
}

/**
 * **The week's skeleton stands on the ledger's columns** (docs/design/
 * pixel-craft.md, class 11: 0px of shift on load). Copied by hand, it drifted:
 * its rows missed the loaded row's `sm:px-4`, so from `sm` up its time bar and
 * title stood 16px left of the loaded ones (192px from the list's edge against
 * 208), and its numeral was a fixed 40px block beside the loaded numeral's two
 * tabular digits. Both now draw from the same class strings, and each half of
 * the pair is asserted here.
 */
describe("the shopfront's loading week", () => {
  it("draws its rows in the loaded row's box, on the loaded row's time rail", () => {
    const { container } = render(<TripsLoading />);

    // Two day groups of two rows.
    const rows = wearing(container, WEEK_ROW_BOX_CLASS);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.firstElementChild).toHaveClass(...WEEK_TIME_RAIL_CLASS.split(" "));
    }
  });

  it("sets each day rule's numeral and weekday on the loaded rule's columns", () => {
    const { container } = render(<TripsLoading />);

    const numerals = wearing(container, DAY_NUMERAL_CLASS);
    expect(numerals).toHaveLength(2);
    for (const numeral of numerals) {
      const column = numeral.nextElementSibling;
      expect(column).toHaveClass(...DAY_LABEL_COLUMN_CLASS.split(" "));
      // The hairline follows, so it starts where the loaded one does.
      expect(column?.nextElementSibling).toHaveClass("h-px", "flex-1");
    }
  });

  it("is drawn from the classes the loaded ledger wears", () => {
    const { container } = render(
      <WeekLedger
        rows={[
          {
            id: "trip-1",
            dayKey: "2026-09-07",
            dayParts: { day: "7", weekday: "Mon", month: "Sep" },
            href: "/s/blue-mantis/trips/trip-1",
            linkLabel: "Sep 7 · 7:00 AM – 10:30 AM · Two-Tank Reef · 3 spots left",
            timeRange: "7:00 AM – 10:30 AM",
            title: "Two-Tank Reef",
            lens: null,
            course: null,
            site: null,
            requirements: [],
            aboveLevel: null,
            capacityText: "3 spots left",
            capacityTone: "quiet",
            price: "$95",
          },
        ]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const [row] = wearing(container, WEEK_ROW_BOX_CLASS);
    expect(row?.querySelector("a")?.getAttribute("href")).toBe("/s/blue-mantis/trips/trip-1");
    expect(wearing(container, WEEK_TIME_RAIL_CLASS)).toHaveLength(1);
    const [numeral] = wearing(container, DAY_NUMERAL_CLASS);
    expect(numeral).toHaveTextContent("7");
    expect(numeral?.nextElementSibling).toHaveClass(...DAY_LABEL_COLUMN_CLASS.split(" "));
  });
});

/**
 * **The storefront's skeleton is the storefront** (pixel-craft class 11,
 * K-214). It drew a text hero and one `max-w-md` card, 360px of identity
 * band, where the page has grown a cover photograph (or a sky panel), a
 * rating line, a badge wall and a full-width row of identity panels: the
 * band is 953px at 1280 on the photo shop, so the week landed about 590px
 * below where the skeleton drew it. And the week's rows sat on the column's
 * edge with bars under their lines, where the loaded rows start 16px in.
 */
describe("the storefront's skeleton", () => {
  function band() {
    const { container } = render(<TripsLoading />);
    return container.querySelector("main > div") as HTMLElement;
  }

  it("leads with the cover panel at ShopfrontHero's aspect", () => {
    const hero = band().firstElementChild;
    expect(hero).toHaveClass("rounded-panel", "border", "mb-6");
    expect(hero?.firstElementChild).toHaveClass("aspect-[4/3]", "sm:aspect-[16/7]", "w-full");
  });

  it("draws the rating line and the badge wall's 36px chips under it", () => {
    const [, rating, badges] = Array.from(band().children);
    expect(rating).toHaveClass("h-6");
    expect(badges).toHaveClass("mt-4", "flex", "flex-wrap", "gap-2");
    for (const chip of Array.from(badges.children)) {
      expect(chip).toHaveClass("h-9", "rounded-full");
    }
  });

  it("lays the identity panels out as the page's one row from md", () => {
    const row = band().lastElementChild;
    expect(row).toHaveClass("mt-6", "grid", "gap-4", "md:auto-cols-fr", "md:grid-flow-col");
    const panels = Array.from(row?.children ?? []);
    expect(panels.length).toBeGreaterThan(1);
    for (const panel of panels) expect(panel).toHaveClass("rounded-panel", "shadow-bed");
  });

  it("draws the week's heading, pills and filter at their line boxes", () => {
    const { container } = render(<TripsLoading />);
    const week = container.querySelector("main > div:nth-child(2)");
    const [heading, months, lenses, filter] = Array.from(week?.children ?? []);
    expect(heading?.firstElementChild).toHaveClass("h-7");
    expect(heading?.lastElementChild).toHaveClass("mt-1", "h-5");
    expect(months?.lastElementChild).toHaveClass("size-11");
    for (const pill of Array.from(lenses?.children ?? [])) {
      expect(pill).toHaveClass("h-11", "rounded-full");
    }
    expect(filter).toHaveClass("mb-6", "h-11");
  });

  it("starts each departure 16px in from sm, with a bar for each line", () => {
    const { container } = render(<TripsLoading />);
    const rows = Array.from(container.querySelectorAll("main .sm\\:px-4"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const [time, words, trailing] = Array.from(row.children);
      expect(time.firstElementChild).toHaveClass("h-6");
      expect(words.children[0]).toHaveClass("h-6");
      expect(words.children[1]).toHaveClass("mt-1", "h-5");
      expect(trailing).toHaveClass("h-6");
    }
  });
});
