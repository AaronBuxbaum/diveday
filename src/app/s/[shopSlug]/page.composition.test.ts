import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The public schedule's identity band has one next-departure surface. The
 * route source is the useful assertion here: rendering the server page needs
 * a live shop and schedule, while the regression is the JSX order and the
 * accidental reintroduction of the old two-column card slot.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

function positionOf(marker: string): number {
  return SOURCE.indexOf(marker);
}

function countOf(marker: string): number {
  return SOURCE.split(marker).length - 1;
}

describe("the public schedule identity composition", () => {
  it("puts one next-boat surface directly after the shop identity", () => {
    const hero = positionOf("<ShopfrontHero");
    const nextBoat = positionOf("<NextBoatCard");
    const schedule = positionOf("<div className={isEmbed ? undefined : SECTION_GAP}>");
    const weekLedger = positionOf("<WeekLedger");

    for (const marker of [hero, nextBoat, schedule, weekLedger]) {
      expect(marker).toBeGreaterThan(-1);
    }
    expect(hero).toBeLessThan(nextBoat);
    expect(nextBoat).toBeLessThan(schedule);
    expect(nextBoat).toBeLessThan(weekLedger);
    expect(countOf("<NextBoatCard")).toBe(1);
    expect(SOURCE).not.toContain("lg:grid-cols-[minmax(0,1fr)_20rem]");
  });
});

/**
 * **The pager row reads the list's own gate.** The week's list hands its last
 * row's 16px (20px from `sm`) of hover room back below itself (`WeekLedger`),
 * so the section after it measures from the last row's words. The "Show later
 * departures" row takes that room into its own margin
 * (`WEEK_LEDGER_FOLLOWER_CLASS`, spelled beside the hand-back) and so still
 * sits 20px under the last row's box. Under an empty state nothing is handed
 * back, and it keeps its 20px. The list and the margin are chosen on one name,
 * so a state added to the render cannot leave the pager's margin on the old
 * condition.
 */
describe("the schedule's pager row", () => {
  it("takes the list's follower margin exactly when the list renders", () => {
    expect(countOf("const showsWeekLedger = ")).toBe(1);
    expect(countOf("<WeekLedger")).toBe(1);
    // The list renders on that name, and on nothing else.
    expect(SOURCE).toMatch(/\{showsWeekLedger \? \(\s*<WeekLedger\b/);
    const pager = SOURCE.slice(positionOf("(nextCursor || after || explicitMonth) ? ("));
    expect(pager).toMatch(
      /^[^<]*<div\s+className=\{`flex flex-wrap items-center gap-3 \$\{showsWeekLedger \? WEEK_LEDGER_FOLLOWER_CLASS : "mt-5"\}`\}/,
    );
  });
});

/**
 * **One rung for the storefront's section heads** (docs/design/pixel-craft.md,
 * class 12). The off-season "Ask us for a day" is a `DateRequestForm` section,
 * which heads itself as a lead (24px) unless told otherwise; every other h2
 * here is the brand face at `SECTION_TITLE_CLASS` (18px).
 */
describe("the off-season ask's heading", () => {
  it("is handed the rung the page's other section heads use", () => {
    const start = positionOf("<DateRequestForm");
    const end = SOURCE.indexOf("/>", start);
    const call = SOURCE.slice(start, end);
    expect(call).toContain("headingClassName={`font-brand-display ${SECTION_TITLE_CLASS}`}");
    expect(SOURCE).toContain(
      '<h2 id="boats-heading" className={`font-brand-display ${SECTION_TITLE_CLASS}`}>',
    );
  });
});

/**
 * **The lens rail's place** — ADR 20260904-reef-all-the-way-down, decision 2
 * (issue #1162).
 *
 * `e2e/schedule-filters.spec.ts` and `e2e/trip-admission.spec.ts` address the
 * departures as the `ul` immediately after the filter form, across seven
 * assertions. An element sibling slipped between the two breaks every one of
 * them, and nothing about that failure names the rail. So the order is a
 * source-level assertion here, where a later edit meets it first.
 */
describe("the lens rail's place", () => {
  it("renders once, after the month nav and above the filter form", () => {
    const monthNav = positionOf('aria-label={t("schedule.monthNav")}');
    const rail = positionOf("<FilterChips");
    const filters = positionOf("<ScheduleFilters");
    const weekLedger = positionOf("<WeekLedger");

    for (const marker of [monthNav, rail, filters, weekLedger]) {
      expect(marker).toBeGreaterThan(-1);
    }
    expect(countOf("<FilterChips")).toBe(1);
    expect(monthNav).toBeLessThan(rail);
    expect(rail).toBeLessThan(filters);
    expect(filters).toBeLessThan(weekLedger);
  });

  it("stands down inside the frame, which promises no navigation landmarks", () => {
    // `FilterChips` renders a `<nav>`, and `e2e/schedule-embed.spec.ts` asserts
    // the widget has literally zero navigation landmarks.
    expect(SOURCE).toContain("hasUpcoming && !isEmbed && lenses.length > 0");
    expect(SOURCE).toContain("isEmbed ? [] : await listTripLenses(");
  });
});

/**
 * **One gap between the storefront's sections** (docs/design/pixel-craft.md,
 * class 4; K-176). Each section spaced itself with its own `mt-*`, and the
 * week was `mt-10` where every other section was `mt-12`, so "Schedule" stood
 * 8px closer to the band above it than any other heading to its neighbour.
 * The gap is spelled once, and the route's skeleton opens its week at it too.
 */
describe("the storefront's section rhythm", () => {
  it("spells the section gap once and opens every section with it", () => {
    expect(SOURCE).toContain('const SECTION_GAP = "mt-12";');
    expect(countOf('"mt-12"')).toBe(1);
    expect(SOURCE).not.toMatch(/\bmt-10\b/);
    expect(SOURCE).toContain("<div className={isEmbed ? undefined : SECTION_GAP}>");
    for (const id of ["boats-heading", "more-ways-heading"]) {
      expect(SOURCE).toContain(`<section aria-labelledby="${id}" className={SECTION_GAP}>`);
    }
    // The sections a component draws take the gap as a prop. The first JSX
    // call of each (a comment may name the component before it does).
    for (const component of ["<DateRequestForm\n", "<CoursesShelf\n", "<ShopReviews\n"]) {
      const start = positionOf(component);
      const call = SOURCE.slice(start, SOURCE.indexOf("/>", start));
      expect(call, component).toContain("className={SECTION_GAP}");
    }
  });

  it("opens the skeleton's week at the same gap", () => {
    const skeleton = readFileSync(join(__dirname, "loading.tsx"), "utf8");
    expect(skeleton).not.toMatch(/\bmt-10\b/);
    expect(skeleton).toMatch(/className="mt-12 animate-pulse"/);
  });
});

/**
 * **The boat that is out** — ADR 20260904-reef-all-the-way-down, Budget rule
 * 4, slice 16c.
 */
describe("the live boat panel's place", () => {
  it("sits in the identity band, above the next departure", () => {
    const live = positionOf("<LiveBoatPanel");
    const hero = positionOf("<ShopfrontHero");
    const nextBoat = positionOf("<NextBoatCard");
    expect(live).toBeGreaterThan(hero);
    expect(live).toBeLessThan(nextBoat);
    expect(countOf("<LiveBoatPanel")).toBe(1);
  });

  it("is never rendered inside the frame", () => {
    // `?embed=1` is a window onto the schedule (issue #805); a live panel
    // would spend a third of a widget on a fact the host page did not ask for.
    expect(positionOf("<LiveBoatPanel")).toBeGreaterThan(positionOf("{isEmbed ? null : ("));
    expect(SOURCE).toContain("isEmbed || !shop.publicBoatLine");
  });

  it("is never read for a shop that has not said the world may see its boats", () => {
    // ADR 20260908-one-hand, decision 6, lever U, owner call (j): one switch
    // covers the storefront's line, its Follow door and the boat's own page,
    // and it is off until a shop turns it on. Pinned at the *read* rather than
    // at the render, so no later edit can leave the query running and hide its
    // answer — which is how an operational fact reaches a page that is meant
    // not to have it.
    expect(SOURCE).toContain("!shop.publicBoatLine\n        ? null\n        : liveShopStage(");
    expect(countOf("liveShopStage(")).toBe(1);
  });
});
