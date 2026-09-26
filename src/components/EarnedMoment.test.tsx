// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EARNED_MOMENT_SURFACE, EarnedMoment, EarnedMomentLine } from "./EarnedMoment";
import { sectionCardClass } from "./ui/card";

afterEach(cleanup);

/**
 * The compact shape (issue 761) — pinned so a future call site cannot drift
 * back into rebuilding the coral line by hand the way Today, the departure
 * board and the gear register each once did.
 */
describe("EarnedMomentLine", () => {
  it("announces itself as a status, so a screen reader hears the moment without a reload", () => {
    render(<EarnedMomentLine>Everyone’s aboard.</EarnedMomentLine>);
    expect(screen.getByRole("status")).toHaveTextContent("Everyone’s aboard.");
  });

  it("carries the rationed accent classes and rise-in, the reduced-motion kill-switch's hook", () => {
    render(<EarnedMomentLine>All home</EarnedMomentLine>);
    const line = screen.getByRole("status");
    expect(line.className).toContain("rise-in");
    expect(line.className).toContain("border-accent/40");
    expect(line.className).toContain("bg-accent/10");
  });

  it("drops the entrance for a moment that was already true on arrival", () => {
    // The first-paint guard a caller owns (the counter's `CounterClearedLine`
    // is the one in the tree): a boat cleared an hour ago is a fact, not a
    // thing that just happened, and replaying the celebration on every visit
    // is what makes it stop meaning anything. The accent stays; only the
    // motion goes.
    render(<EarnedMomentLine animate={false}>All home</EarnedMomentLine>);
    const line = screen.getByRole("status");
    expect(line.className).not.toContain("rise-in");
    expect(line.className).toContain("bg-accent/10");
  });

  it("merges a caller's className rather than replacing the line's own", () => {
    render(<EarnedMomentLine className="mt-4">All home</EarnedMomentLine>);
    expect(screen.getByRole("status").className).toContain("mt-4");
  });

  it("supplies no glyph — a moment's mark belongs in its words, where a translator can see it", () => {
    render(<EarnedMomentLine>All home</EarnedMomentLine>);
    expect(screen.getByRole("status").textContent).toBe("All home");
  });
});

/**
 * The whole-page moment's geometry (docs/design/pixel-craft.md). The heading is
 * the panel's only content on `/ready`'s booking-confirmed card, so a margin it
 * carries for a missing eyebrow pushes it off the panel's centre.
 */
describe("EarnedMoment", () => {
  it("puts no top margin on the heading when there is no eyebrow to clear", () => {
    // The heading's own `mt-1` sat it 2px below centre in the booking-confirmed
    // card: 39px from the panel's inner top to the cap, 35px from the baseline
    // to its inner bottom.
    render(<EarnedMoment title="You're booked" />);
    const heading = screen.getByRole("heading", { name: "You're booked" });
    expect(heading.className).not.toMatch(/(^|\s)mt-/);
  });

  it("pads its content on SectionCard's lg rung, so its text starts where the cards beside it start", () => {
    // `p-6 sm:p-7` put the recap's welcome text 4px right of every card under
    // it: x 405 against 401 at 1280, 45 against 41 at 390. The rung is read from
    // `sectionCardClass`, so the two cannot drift apart again.
    const padding = (classes: string) =>
      classes.split(/\s+/).filter((token) => /^(?:sm:)?p-/.test(token));
    const { container } = render(<EarnedMoment title="Welcome back" />);
    const section = container.querySelector("section");
    expect(padding(section?.className ?? "")).toEqual(padding(sectionCardClass({ padding: "lg" })));
  });

  it("keeps the 4px between an eyebrow and the heading on the eyebrow", () => {
    render(<EarnedMoment eyebrow="Reef Divers" title="You're booked" />);
    expect(screen.getByText("Reef Divers")).toHaveClass("mb-1");
    expect(screen.getByRole("heading").className).not.toMatch(/(^|\s)mt-/);
  });
});

/**
 * The panel shape, for the one surface with a heading of its own
 * (close-out) rather than a single line — a class string rather than a third
 * component, so the vocabulary still lives in one place.
 */
describe("EARNED_MOMENT_SURFACE", () => {
  it("carries the same rationed accent vocabulary as the line and the whole-page moment", () => {
    expect(EARNED_MOMENT_SURFACE).toContain("rise-in");
    expect(EARNED_MOMENT_SURFACE).toContain("border-accent/40");
    expect(EARNED_MOMENT_SURFACE).toContain("bg-accent/10");
  });
});

describe("the whole-page moment's inset", () => {
  function momentFor(title: string) {
    return screen.getByRole("heading", { name: title }).closest("section");
  }

  /**
   * On /ready the booked moment heads a column of `md` cards, and its own
   * `p-6 sm:p-7` started "You’re on the boat" 8px inside "Where to go": 45
   * against 37 at 390, 405 against 397 at 1280 (K-52, TOKEN-2-07). Asked to,
   * it sits at the card inset, so the column's titles share one left edge.
   */
  it("sits at a card's md inset when asked to", () => {
    render(<EarnedMoment title="You’re on the boat" inset="card" />);
    const cardInset = sectionCardClass()
      .split(" ")
      .filter((name) => /^(sm:)?p-\d/.test(name));
    expect(cardInset).toEqual(["p-4", "sm:p-5"]);
    expect(momentFor("You’re on the boat")).toHaveClass(...cardInset);
    expect(momentFor("You’re on the boat")?.className).not.toMatch(/(^|\s)(sm:)?p-[67](\s|$)/);
  });

  /**
   * Where it opens a page it keeps the default, SectionCard's `lg` rung
   * (K-109): a step wider, `p-6 sm:p-7`, put the recap's welcome 4px right of
   * the cards under it.
   */
  it("keeps the lg rung where it opens a page, a step wider than the card inset", () => {
    render(<EarnedMoment as="h1" title="Waiver signed" />);
    const lgInset = sectionCardClass({ padding: "lg" })
      .split(" ")
      .filter((name) => /^(sm:)?p-\d/.test(name));
    expect(lgInset).toEqual(["p-5", "sm:p-6"]);
    expect(momentFor("Waiver signed")).toHaveClass(...lgInset);
  });
});
