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
    course: null,
    site: "Molasses Reef and French Reef",
    requirements: ["Open Water or higher"],
    aboveLevel: null,
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

  it("leaves routine availability as a quiet fact rather than a badge", () => {
    render(<WeekLedger rows={[row()]} listLabel="Upcoming trips" stickyTop="top-(--chrome-h)" />);

    const seats = screen.getByText("3 spots left");
    expect(seats.className).toContain("text-muted");
    expect(seats.className).not.toContain("bg-warning-tint");
  });

  it("renders no price cell for a departure with no price set", () => {
    render(
      <WeekLedger
        rows={[row({ price: null })]}
        listLabel="Upcoming trips"
        stickyTop="top-(--chrome-h)"
      />,
    );

    expect(screen.getByRole("listitem").textContent).not.toContain("$");
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
});
