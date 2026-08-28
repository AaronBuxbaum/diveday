// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { sectionCardClass } from "@/components/ui/card";
import { type MonthFigure, MonthFigures } from "./MonthFigures";

afterEach(cleanup);

/**
 * Slice 9f of ADR 20260827-the-shops-shelves — "Reports keeps its shape and
 * sheds its chrome" — and decision 11's coral budget.
 *
 * These pin the rules, never the layout. A screenshot of five columns would
 * fail on the next legitimate restyle and teach the next reader to re-baseline
 * without looking; what must not drift is that the figures are *unboxed*, that
 * the celebration is rationed and earned, and that a month with nothing in it
 * draws nothing.
 */

const FIGURES: MonthFigure[] = [
  { key: "revenue", label: "Net revenue", value: "$12,481", comparison: "up 18% vs $10,560" },
  { key: "tips", label: "Tips", value: "$640", detail: "31 tips" },
  { key: "seats", label: "Seats", value: "214", detail: "across 24 trips" },
  { key: "fill", label: "Fill", value: "78%", detail: "6 boats full" },
  {
    key: "waivers",
    label: "Waivers",
    value: "96%",
    detail: "9 still to collect",
    detailTone: "attention",
  },
];

function renderFigures(figures: MonthFigure[] = FIGURES) {
  return render(<MonthFigures label="This month's numbers" figures={figures} />);
}

describe("the figures are unboxed", () => {
  it("wears no card chrome anywhere in the row", () => {
    const { container } = renderFigures();
    const markup = container.innerHTML;
    // The two halves of the card's own spelling that make a box a box — read
    // out of the component that owns it rather than written here, so a later
    // change to the shell moves this check with it. `border`/`border-border`
    // are deliberately not in the set: hairlines are what the figures are
    // separated *by*, and a card has no monopoly on them.
    const boxed = sectionCardClass()
      .split(/\s+/)
      .filter((token) => token === "rounded-2xl" || token === "bg-surface");
    expect(boxed).toHaveLength(2);
    for (const token of boxed) {
      expect(markup).not.toContain(token);
    }
    // Nor an elevation: at rest, nothing on this page floats (decision 1).
    expect(markup).not.toContain("shadow");
    // The one chrome it does wear: the band's own two hairlines.
    expect(container.querySelector("dl")?.className).toContain("border-y");
  });

  it("sets every figure at the ramp's figure size, tabular", () => {
    renderFigures();
    for (const figure of FIGURES) {
      const value = screen.getByText(figure.value);
      expect(value.className).toContain("text-3xl");
      expect(value.className).toContain("tabular-nums");
    }
  });
});

describe("a month with nothing in it", () => {
  it("renders no figure row at all rather than a row of zeroes", () => {
    const { container } = render(<MonthFigures label="This month's numbers" figures={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("the coral budget", () => {
  it("spends the accent on the one earned line, and only when it is earned", () => {
    renderFigures();
    // Nothing on an ordinary month is coral: the outstanding waivers line is
    // warning ink, which is work to chase rather than a celebration.
    expect(document.body.innerHTML).not.toContain("bg-accent");
    expect(screen.getByText("9 still to collect").className).toContain("text-warning-strong");
  });

  it("renders the earned line in place of the detail, never beside it", () => {
    const allIn = FIGURES.map((figure) =>
      figure.key === "waivers"
        ? { ...figure, value: "100%", detail: undefined, earned: "Everyone's paperwork is in" }
        : figure,
    );
    renderFigures(allIn);
    const earned = screen.getByText("Everyone's paperwork is in");
    expect(earned.className).toContain("bg-accent/10");
    expect(screen.queryByText("9 still to collect")).toBeNull();
    // One accent element on the surface, not one per figure.
    expect(document.querySelectorAll("[class*='bg-accent']")).toHaveLength(1);
  });

  it("does not replay the entrance on a page that simply loaded complete", () => {
    // A month that closed complete is a fact on arrival, not a thing that just
    // happened — `rise-in` here would celebrate every visit to a past month.
    renderFigures(
      FIGURES.map((figure) =>
        figure.key === "waivers" ? { ...figure, earned: "Everyone's paperwork is in" } : figure,
      ),
    );
    expect(screen.getByText("Everyone's paperwork is in").className).not.toContain("rise-in");
  });
});
