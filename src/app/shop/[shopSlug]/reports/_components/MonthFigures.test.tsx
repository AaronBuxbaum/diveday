// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { tapTargetLinkClass } from "@/components/ui/button";
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
  return render(<MonthFigures label="This month’s numbers" figures={figures} />);
}

describe("the band's rules", () => {
  it("run 8px past the column each side, as the ledger's below do, with every figure keeping 8px of start room", () => {
    // The departures ledger under this band keeps a `LedgerRow`'s room, so its
    // rules reach 8px past the column (src/components/ui/ledger.tsx). A band
    // left on the column drew its rules 8px short of the ledger's at both ends.
    const { container } = renderFigures();
    const band = container.querySelector("dl");
    expect(band).toHaveClass("-mx-2", "border-y");
    const cells = [...(band?.children ?? [])];
    expect(cells).toHaveLength(FIGURES.length);
    for (const cell of cells) {
      // The room comes back as start padding, so the first figure of each
      // visual row starts on the column; a figure beside another keeps its
      // 24px gutter at the breakpoint where it has a neighbour.
      expect(cell).toHaveClass("ps-2");
    }
    expect(cells[1]).toHaveClass("sm:ps-6");
    expect(cells[2]).toHaveClass("lg:ps-6");
  });

  it("gives a stacked figure the band's 8px back on the right too, and the 24px gutter only where it has a neighbour", () => {
    // On a phone the figures stack one to a row, and a figure alone in its row
    // has nothing beside it for a gutter to keep it from: an unconditional
    // `pe-6` left the rule running 24px past the words on the right and 8px
    // on the left (K-573, reports-figures at 390).
    const { container } = renderFigures();
    const cells = [...(container.querySelector("dl")?.children ?? [])];
    for (const cell of cells) {
      expect(cell).toHaveClass("pe-2", "sm:pe-6");
      expect(cell).not.toHaveClass("pe-6");
    }
  });
});

describe("the lines under a figure", () => {
  it("start 8px under the value whichever of them render: one mt-2 space-y-1 block holds the detail and the comparison", () => {
    // Revenue has a comparison and no detail; its comparison was the first
    // line under its value at `mt-1`, where every other figure's first line
    // (a detail) sat at `mt-2` — 4px higher than its neighbours' (K-287).
    renderFigures([
      ...FIGURES.slice(0, 1),
      { ...FIGURES[1], comparison: "up 4% vs $615" },
      ...FIGURES.slice(2),
    ]);
    const revenueComparison = screen.getByText("up 18% vs $10,560");
    const tipsDetail = screen.getByText("31 tips");
    const tipsComparison = screen.getByText("up 4% vs $615");
    for (const line of [revenueComparison, tipsDetail]) {
      expect(line.parentElement).toHaveClass("mt-2", "space-y-1");
    }
    // A detail and its comparison share the block, a step apart.
    expect(tipsComparison.parentElement).toBe(tipsDetail.parentElement);
    // No line spaces itself: the block owns the offset and the step.
    for (const line of [revenueComparison, tipsDetail, tipsComparison]) {
      expect([...line.classList].filter((token) => /^m[ty]?-/.test(token))).toEqual([]);
    }
  });

  it("holds the earned line in the same block, without a margin of its own", () => {
    renderFigures(
      FIGURES.map((figure) =>
        figure.key === "waivers"
          ? { ...figure, detail: undefined, earned: "Everyone’s paperwork is in" }
          : figure,
      ),
    );
    const earned = screen.getByText("Everyone’s paperwork is in");
    expect(earned.parentElement).toHaveClass("mt-2", "space-y-1");
    expect(earned).not.toHaveClass("mt-2");
  });

  it("draws no empty block under a figure that speaks alone", () => {
    // An empty `mt-2` block is a phantom 8px under the value.
    renderFigures([{ key: "alone", label: "Seats", value: "214" }]);
    const value = screen.getByText("214");
    expect(value.parentElement?.children).toHaveLength(1);
  });
});

describe("the figure's link", () => {
  it("is a 44px target in a 20px line, so the target grows without moving the line", () => {
    // "View orders" was an `inline-block` 14px link, a 78x20 target on a
    // phone (K-288). The line box keeps the text-sm line's 20px and the link
    // takes the shared tap-target floor, overhanging it evenly.
    renderFigures([
      {
        ...FIGURES[0],
        link: { href: "/shop/blue-mantis/orders", label: "View orders" },
      },
      ...FIGURES.slice(1),
    ]);
    const link = screen.getByRole("link", { name: "View orders" });
    expect(link.className).toContain(tapTargetLinkClass);
    expect(link).not.toHaveClass("mt-2");
    expect(link.parentElement).toHaveClass("mt-2", "flex", "h-5", "items-center");
  });
});

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
      .filter(
        (token) => token === "rounded-panel" || token === "bg-surface" || token === "shadow-bed",
      );
    expect(boxed).toHaveLength(3);
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
    const { container } = render(<MonthFigures label="This month’s numbers" figures={[]} />);
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
        ? { ...figure, value: "100%", detail: undefined, earned: "Everyone’s paperwork is in" }
        : figure,
    );
    renderFigures(allIn);
    const earned = screen.getByText("Everyone’s paperwork is in");
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
        figure.key === "waivers" ? { ...figure, earned: "Everyone’s paperwork is in" } : figure,
      ),
    );
    expect(screen.getByText("Everyone’s paperwork is in").className).not.toContain("rise-in");
  });
});
