// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WeekLedger, type WeekLedgerRow } from "./WeekLedger";

/**
 * The week ledger's pins for ADR 20260827-clearwater-surface-language,
 * decision 8 — the rules, never the pixels. Every "renders nothing" assertion
 * here is guarding one of the design's silences: the requirement slot on a
 * departure that demands nothing, the price cell on a departure with no price,
 * and the second detail line that used to stack under every title.
 */
afterEach(cleanup);

function row(overrides: Partial<WeekLedgerRow> = {}): WeekLedgerRow {
  return {
    id: "trip-1",
    dayKey: "2026-08-27",
    dayParts: { day: "27", weekday: "Thu", month: "Aug" },
    href: "/s/blue-mantis/trips/trip-1",
    linkLabel: "Aug 27 · 7:00 AM – 10:30 AM · Two-Tank Reef · 3 spots left",
    timeRange: "7:00 AM – 10:30 AM",
    title: "Two-Tank Reef — Molasses & French",
    lens: null,
    course: null,
    site: "Molasses Reef and French Reef",
    requirements: ["Open Water or higher"],
    aboveLevel: null,
    clears: null,
    capacityText: "3 spots left",
    capacityTone: "quiet",
    price: "$95.00",
    ...overrides,
  };
}

/** Every paragraph in the row's body column — the slot a detail line would come back into. */
function bodyLines(item: HTMLElement): HTMLParagraphElement[] {
  const body = item.querySelector(".min-w-0.flex-1");
  return Array.from(body?.querySelectorAll("p") ?? []);
}

/** The row's one meta line, or `null` when the row renders none. */
function metaLine(item: HTMLElement): string | null {
  return bodyLines(item)[0]?.textContent ?? null;
}

describe("a week row is a link, never a button", () => {
  it("renders one door per row and no button anywhere in the ledger", () => {
    render(
      <WeekLedger
        rows={[
          row(),
          row({ id: "trip-2", title: "Night Dive", linkLabel: "Aug 27 · 7:30 PM · Night Dive" }),
        ]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("link", { name: /Two-Tank Reef/ })).toHaveAttribute(
      "href",
      "/s/blue-mantis/trips/trip-1",
    );
  });

  /**
   * The day rule pins over the list, 60px tall, and the page's scroll inset
   * clears only the chrome above it: a row focused anywhere from 56 to 116px
   * down counted as in view and stayed under its own rule (pixel-craft class
   * 9). The row's door keeps 64px — the rule and 4px — clear of the top, on
   * the page (on top of the chrome's inset) and in the embed.
   */
  it("keeps a focused row's door clear of the day rule pinned above it", () => {
    render(<WeekLedger rows={[row()]} listLabel="Upcoming trips" stickyTop="top-(--chrome-h)" />);

    expect(screen.getByRole("link", { name: /Two-Tank Reef/ })).toHaveClass("scroll-mt-16");
  });

  it("adds the course's own link as the row's one nested door", () => {
    render(
      <WeekLedger
        rows={[
          row({
            course: {
              label: "Course session",
              title: "Open Water Diver",
              href: "/s/blue-mantis/courses/open-water-diver",
            },
          }),
        ]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    expect(screen.getByRole("link", { name: "Open Water Diver" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/courses/open-water-diver",
    );
  });
});

describe("one meta line, and nothing stacked under it", () => {
  it("joins the course, the site and every requirement into a single line", () => {
    render(
      <WeekLedger
        rows={[
          row({
            course: { label: "Course session", title: "Deep Diver", href: "/c/deep" },
            site: "USCGC Duane",
            requirements: ["Advanced Open Water or higher", "Deep", "Nitrox"],
          }),
        ]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const item = screen.getByRole("listitem");
    expect(metaLine(item)).toBe(
      "Course session · Deep Diver · USCGC Duane · Advanced Open Water or higher · Deep · Nitrox",
    );
    // **Exactly one** line in the row's body — the six stacked lines are gone,
    // and this is the assertion that stops one coming back.
    expect(bodyLines(item)).toHaveLength(1);
  });

  it("renders no meta line at all when the row has nothing to say beyond its title", () => {
    render(
      <WeekLedger
        rows={[row({ course: null, site: null, requirements: [], aboveLevel: null })]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const item = screen.getByRole("listitem");
    expect(item.textContent).not.toContain("·");
  });

  /**
   * **The lens leads the line, and its absence is silent** — ADR
   * 20260904-reef-all-the-way-down, decision 2 (issue #1162).
   */
  it("puts the shop's own word first, before the course and the site", () => {
    render(
      <WeekLedger
        rows={[
          row({
            lens: "Easygoing reef",
            course: null,
            site: "Molasses Reef and French Reef",
            requirements: ["Open Water or higher"],
          }),
        ]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const item = screen.getByRole("listitem");
    expect(metaLine(item)).toBe(
      "Easygoing reef · Molasses Reef and French Reef · Open Water or higher",
    );
    expect(bodyLines(item)).toHaveLength(1);
  });

  it("renders the same line with no leading separator when the departure wears no word", () => {
    // Never "Uncategorised", and never a dangling "·" where a word would be.
    render(
      <WeekLedger
        rows={[row({ lens: null, course: null, site: "Molasses Reef" })]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const item = screen.getByRole("listitem");
    expect(metaLine(item)).toBe("Molasses Reef · Open Water or higher");
  });

  it("still renders exactly one paragraph when the lens is the row's only meta", () => {
    render(
      <WeekLedger
        rows={[
          row({ lens: "After dark", course: null, site: null, requirements: [], aboveLevel: null }),
        ]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const item = screen.getByRole("listitem");
    expect(metaLine(item)).toBe("After dark");
    expect(bodyLines(item)).toHaveLength(1);
  });
});

/**
 * **A fact moves to the next line whole** (pixel-craft class 8). The meta line
 * wrapped at every space, so on a phone a fact broke in two — "Advanced Open /
 * Water or higher", "Scuba / Refresher" — five times on the schedule at 390.
 * Each fragment is one inline box, so the line breaks at a " · " between
 * facts, and only a fact longer than the whole line wraps inside itself. Not
 * `whitespace-nowrap`: a long site name would run past the column.
 */
describe("a fact on the meta line moves whole", () => {
  it("sets every fragment as one box", () => {
    render(
      <WeekLedger
        rows={[
          row({
            id: "course",
            lens: "First time back in a while",
            course: { label: "Course session", title: "Scuba Refresher", href: "/c/refresher" },
            site: "Molasses Reef",
            requirements: [],
          }),
          row({
            id: "above",
            site: "USCGC Duane",
            requirements: ["Advanced Open Water or higher", "Deep"],
            aboveLevel: "Above your level",
          }),
          row({
            id: "clears",
            requirements: ["Advanced Open Water or higher"],
            clears: "Your Advanced card clears this",
          }),
        ]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const fragments = screen
      .getAllByRole("listitem")
      .flatMap((item) => Array.from(bodyLines(item)[0]?.children ?? []));
    expect(fragments.map((fragment) => fragment.textContent)).toEqual([
      "First time back in a while",
      "Course session · Scuba Refresher",
      "Molasses Reef",
      "USCGC Duane",
      "Advanced Open Water or higher",
      "Deep",
      "Above your level",
      "Molasses Reef and French Reef",
      "Advanced Open Water or higher",
      "Your Advanced card clears this",
    ]);
    for (const fragment of fragments) expect(fragment).toHaveClass("inline-block");
  });

  it("keeps a course's name whole inside its fragment, so an overlong one breaks after the label", () => {
    render(
      <WeekLedger
        rows={[
          row({
            course: { label: "Course session", title: "Scuba Refresher", href: "/c/refresher" },
          }),
        ]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    expect(screen.getByRole("link", { name: "Scuba Refresher" })).toHaveClass("inline-block");
  });
});

describe("the requirement slot's silence", () => {
  it("says nothing when the departure demands nothing — site, seats and price only", () => {
    render(
      <WeekLedger
        rows={[row({ requirements: [], site: "Christ of the Abyss" })]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const item = screen.getByRole("listitem");
    expect(metaLine(item)).toBe("Christ of the Abyss");
    // No "no certification needed", and no fit words standing in for a rule
    // that is simply absent.
    expect(item.textContent).not.toMatch(/certification/i);
  });

  it("carries the above-your-level word beside the requirement, so the dimming has a name", () => {
    render(
      <WeekLedger
        rows={[
          row({ requirements: ["Advanced Open Water or higher"], aboveLevel: "Above your level" }),
        ]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const item = screen.getByRole("listitem");
    expect(metaLine(item)).toBe(
      "Molasses Reef and French Reef · Advanced Open Water or higher · Above your level",
    );
    // Quiet is *measured* ink on the title, never a wrapper opacity — an
    // `opacity-60` over the row dims every token below its measured contrast
    // (principles.md, tokens; 2026-08-28 diver-views review finding 1).
    expect(item.querySelector(".opacity-60")).toBeNull();
    expect(screen.getByRole("heading", { level: 3 }).className).toContain("text-muted");
  });
});

describe("seat state and price", () => {
  it("quiets a full row in measured ink and marks it with a neutral badge", () => {
    render(
      <WeekLedger
        rows={[row({ capacityText: "Full", capacityTone: "full" })]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const item = screen.getByRole("listitem");
    // `text-muted` on the title, never `opacity-60` on the wrapper — the
    // full boat is the wait-list candidate somebody still wants to read.
    expect(item.querySelector(".opacity-60")).toBeNull();
    expect(screen.getByRole("heading", { level: 3 }).className).toContain("text-muted");
    const badge = screen.getByText("Full");
    expect(badge.className).toContain("bg-surface-sunken");
    expect(badge.className).not.toContain("bg-warning-tint");
  });

  it("keeps the warning words and warning tone for scarcity", () => {
    render(
      <WeekLedger
        rows={[row({ capacityText: "Only 2 spots left", capacityTone: "low" })]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    expect(screen.getByText("Only 2 spots left").className).toContain("bg-warning-tint");
    // Routine availability is not an alert, so it is not dimmed.
    expect(screen.getByRole("listitem").querySelector(".opacity-60")).toBeNull();
  });

  /**
   * The seat badge is a 28px pill beside a 24px title line, and its group
   * centres everything in the pill's height: top-aligned with the title, the
   * price and chevron sat 2–3px below the title's line (pixel-craft class 1).
   * On one baseline the badge's word — `Badge` hands its row the word's
   * baseline — the price and the title share a line.
   */
  it("sets the time, the title and the seat state on one baseline", () => {
    render(
      <WeekLedger
        rows={[row({ capacityText: "Only 2 spots left", capacityTone: "low" })]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const box = screen.getByRole("link", { name: /Two-Tank Reef/ }).parentElement;
    expect(box).toHaveClass("sm:items-baseline");
    expect(box).not.toHaveClass("sm:items-start");
  });

  it("leaves routine availability as a quiet fact rather than a badge", () => {
    render(<WeekLedger rows={[row()]} listLabel="Upcoming trips" stickyTop="top-(--chrome-h)" />);

    const seats = screen.getByText("3 spots left");
    expect(seats.className).toContain("text-muted");
    expect(seats.className).not.toContain("bg-warning-tint");
  });

  /**
   * Below `sm` the row is a column, so the trailing group is stretched to the
   * row's width and packs from the start: the chevron sat just after each
   * row's seat words and price, 14 rows at 14 x's across 114px at 390
   * (pixel-craft class 3). `ms-auto` pins it to the row's end; from `sm` up
   * the group has no free space and it does nothing.
   */
  it("pins the chevron to the end of the row", () => {
    render(<WeekLedger rows={[row()]} listLabel="Upcoming trips" stickyTop="top-(--chrome-h)" />);

    const chevron = screen.getByRole("listitem").querySelector("svg");
    expect(chevron).toHaveClass("ms-auto");
  });

  it("prints no price for a departure with no price set", () => {
    render(
      <WeekLedger
        rows={[row({ price: null })]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    expect(screen.getByRole("listitem").textContent).not.toContain("$");
  });

  /**
   * The price was rendered only when there was one, so a departure with no
   * price slid its seat state and chevron into the price's column: "Only 2
   * spots left" at x 952.7 on one row and 995.3 on the next at 1280
   * (pixel-craft class 3). The column now stands on every row, sized for a
   * four-figure price ("$1,250", "$95.50", "1250 €") and ending on one edge,
   * and empty where there is no price.
   */
  it("keeps the price's column when a departure has no price, so the seat state holds its x", () => {
    render(
      <WeekLedger
        rows={[row({ id: "priced" }), row({ id: "unpriced", price: null })]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const [priced, unpriced] = screen
      .getAllByRole("listitem")
      .map((item) => Array.from(item.querySelector("svg")?.parentElement?.children ?? []));
    // Seat state, the price's column, the chevron — on both rows.
    expect(priced).toHaveLength(3);
    expect(unpriced).toHaveLength(3);
    expect(priced[1]).toHaveTextContent("$95.00");
    expect(priced[1]).toHaveClass("sm:min-w-[5.5ch]", "sm:text-end");
    expect(unpriced[1]).toBeEmptyDOMElement();
    expect(unpriced[1]).toHaveClass("sm:min-w-[5.5ch]");
    // Below `sm` the group packs from the start and the chevron holds the
    // row's end on its own, so an empty column there would only add a gap.
    expect(unpriced[1]).toHaveClass("max-sm:hidden");
    expect(priced[1]).not.toHaveClass("max-sm:hidden");
  });
});

/**
 * **The list ends at its last row's words** (pixel-craft class 4). A row keeps
 * `py-4 sm:py-5` of room for its hover fill, unpainted at rest, and the last
 * row's lower half stacked on the next section's own margin: last meta line to
 * "Courses" measured 78px at 1280 and 75px at 390, against the page's 56px
 * section gap. The list hands the same room back below itself.
 */
describe("the list's close", () => {
  it("hands back its last row's unpainted room, so what follows measures from the words", () => {
    render(<WeekLedger rows={[row()]} listLabel="Upcoming trips" stickyTop="top-(--chrome-h)" />);

    const box = screen.getByRole("link", { name: /Two-Tank Reef/ }).parentElement;
    expect(box).toHaveClass("py-4", "sm:py-5");
    expect(screen.getByRole("list", { name: "Upcoming trips" })).toHaveClass("-mb-4", "sm:-mb-5");
  });
});

describe("the day rule", () => {
  it("renders once per shop-local day, above that day's first row", () => {
    render(
      <WeekLedger
        rows={[
          row({ id: "a" }),
          row({ id: "b", title: "Night Dive" }),
          row({
            id: "c",
            dayKey: "2026-08-28",
            dayParts: { day: "28", weekday: "Fri", month: "Aug" },
            title: "Morning Two-Tank",
          }),
        ]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    expect(screen.getAllByText("27")).toHaveLength(1);
    expect(screen.getAllByText("28")).toHaveLength(1);
    // The rules are presentational, so the announced item count stays the
    // number of bookable departures.
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
  it("pins the rule where the caller says, so the chrome bar never paints over it", () => {
    const { container, rerender } = render(
      <WeekLedger rows={[row()]} listLabel="Upcoming trips" stickyTop="top-(--chrome-h)" />,
    );

    // The full page pins the rule *below* the bar, by the token the bar sets
    // its own height from. At `top-0` the bar covers it and the day never
    // shows once the list starts sticking (ADR
    // 20260827-clearwater-surface-language, decision 10).
    expect(container.querySelector(".sticky")?.className).toContain("top-(--chrome-h)");

    rerender(<WeekLedger rows={[row()]} listLabel="Upcoming trips" stickyTop="top-0" />);

    // An embed has no chrome above it, so the top of the frame is the top of
    // the list.
    expect(container.querySelector(".sticky")?.className).toContain("top-0");
  });

  /**
   * **Every part of the rule stands in a fixed column** (pixel-craft class 3).
   * The numeral and the weekday block were shrink-wrapped and the hairline
   * took what was left, so it started at the weekday's ink edge + 15px: nine
   * rules at 1280 started at nine x's across 9px, and a one-digit day would
   * have moved its weekday and hairline a further 19px left.
   */
  it("sets a one-digit day in a two-digit box", () => {
    render(
      <WeekLedger
        rows={[row({ dayParts: { day: "7", weekday: "Mon", month: "Sep" } })]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    // The numeral is `tabular-nums`, so 2ch is exactly two digits.
    expect(screen.getByText("7")).toHaveClass("min-w-[2ch]");
  });

  it("sets the weekday and the month in one column wide enough for the longest label", () => {
    render(
      <WeekLedger
        rows={[row({ dayParts: { day: "7", weekday: "lun", month: "sept" } })]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    const column = screen.getByText("lun").parentElement;
    expect(screen.getByText("sept").parentElement).toBe(column);
    // 56px: es-ES "SEPT" at its tracking is about 51px, en-US "MON" 46.
    expect(column).toHaveClass("min-w-14");
  });
});
