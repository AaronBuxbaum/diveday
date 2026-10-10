// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettledCheck } from "./SettledCheck";
import { SETTLED_CHECK_TEXT_INSET } from "./settled-mark";

afterEach(cleanup);

const mark = (container: HTMLElement) => container.querySelector("svg");

/**
 * ADR 20260827-clearwater-surface-language's delight rule, and its
 * accessibility commitment, in the two places a screenshot cannot check them.
 */
describe("SettledCheck", () => {
  it("renders the state in words as well as in the mark", () => {
    // Every colour-carried state also carries a word. The label is a required
    // prop precisely so there is no way to use this as a bare tick.
    render(<SettledCheck settled label="Checked in" />);
    expect(screen.getByText("Checked in")).toBeInTheDocument();

    cleanup();
    render(<SettledCheck settled={false} label="Not yet here" />);
    expect(screen.getByText("Not yet here")).toBeInTheDocument();
  });

  it("draws a different shape, not only a different color", () => {
    const { container } = render(<SettledCheck settled label="Checked in" />);
    expect(container.querySelectorAll("path")).toHaveLength(1);

    cleanup();
    const unsettled = render(<SettledCheck settled={false} label="Not yet here" />);
    expect(unsettled.container.querySelectorAll("path")).toHaveLength(0);
    expect(unsettled.container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("carries no animation class on first paint, even when it mounts settled", () => {
    // The guard the whole component is shaped around: a page of forty settled
    // rows must arrive still, not pop forty marks at once. A `useState`
    // initialiser cannot tell "just mounted holding true" from "just became
    // true", which is why the ref starts at null.
    const { container } = render(<SettledCheck settled label="Checked in" />);
    expect(mark(container)?.getAttribute("class")).not.toContain("settle-in");

    cleanup();
    const unsettled = render(<SettledCheck settled={false} label="Not yet here" />);
    expect(mark(unsettled.container)?.getAttribute("class")).not.toContain("settle-in");
  });

  it("plays settle-in only on a client-side false -> true transition", () => {
    const { container, rerender } = render(<SettledCheck settled={false} label="Not yet here" />);
    expect(mark(container)?.getAttribute("class")).not.toContain("settle-in");

    rerender(<SettledCheck settled label="Checked in" />);
    expect(mark(container)?.getAttribute("class")).toContain("settle-in");
  });

  it("does not play on the way back down", () => {
    // Nothing settles by becoming unsettled, and the name carries no
    // "out"/"dismiss" word — this is an entrance and only an entrance.
    const { container, rerender } = render(<SettledCheck settled label="Checked in" />);
    rerender(<SettledCheck settled={false} label="Not yet here" />);
    expect(mark(container)?.getAttribute("class")).not.toContain("settle-in");
  });

  it("names the inset a line under its label hangs at, from its own mark and gap", () => {
    // A fact under a step's name used to hang at a hand-picked `ps-8`, 32px
    // against the name's 28 — the 20px mark plus its 8px gap (K-169). The
    // inset is derived here from the classes the component actually renders,
    // so a resized mark or a wider gap moves both together.
    const { container } = render(<SettledCheck settled label="Checked in" />);
    const step = (className: string | null | undefined, prefix: string) =>
      Number(new RegExp(`(?:^|\\s)${prefix}-(\\d+(?:\\.5)?)(?:\\s|$)`).exec(className ?? "")?.[1]);
    const markSize = step(mark(container)?.getAttribute("class"), "size");
    const gap = step(container.firstElementChild?.getAttribute("class"), "gap");
    expect(markSize + gap).toBeGreaterThan(0);
    expect(SETTLED_CHECK_TEXT_INSET).toBe(`ps-${markSize + gap}`);
  });

  /**
   * **What follows the label hangs beside the mark** (pixel-craft class 3,
   * K-593). Today's settled station set its detail and its "closed by" as
   * flex siblings of this component, so a third fact that wrapped started
   * back under the glyph (x 38) instead of under "All home" (x 65). Passed as
   * children, they share the label's text block, which is the mark's
   * neighbour: every line of it starts where the label does.
   */
  it("sets its children in the label's text block, beside the mark and never under it", () => {
    const { container } = render(
      <SettledCheck settled label="All home" labelClassName="font-medium">
        <span>8 of 8 back by 8:30 AM</span>
        <span>last roll call closed by Sal Moretti</span>
      </SettledCheck>,
    );
    const glyph = mark(container);
    const label = screen.getByText("All home");
    const block = label.parentElement;
    expect(block).toBe(screen.getByText("last roll call closed by Sal Moretti").parentElement);
    expect(block).toHaveClass("min-w-0");
    expect(block?.contains(glyph)).toBe(false);
    // The block and the mark are the two halves of one row that starts at the
    // top, so the mark sits on the first line and the rest hangs under text.
    const row = block?.parentElement;
    expect(row?.contains(glyph)).toBe(true);
    expect(row).toHaveClass("flex", "items-start");
    // The weight is the label's alone: the facts after it keep their own.
    expect(label).toHaveClass("font-medium");
    expect(row).not.toHaveClass("font-medium");
  });

  it("stays one inline mark-and-word when it has nothing after the label", () => {
    const { container } = render(<SettledCheck settled label="Checked in" />);
    const label = screen.getByText("Checked in");
    expect(label.parentElement).toHaveClass("inline-flex", "items-center");
    expect(label.parentElement?.contains(mark(container))).toBe(true);
  });

  it("drops the entrance when it un-settles mid-animation", () => {
    // A head count that closes and reopens inside the 200ms used to leave the
    // unsettled mark animating: `onAnimationEnd` is the only thing that cleared
    // the flag, and it cannot fire while the animation is still running.
    const { container, rerender } = render(<SettledCheck settled={false} label="Not yet here" />);
    rerender(<SettledCheck settled label="Checked in" />);
    expect(mark(container)?.getAttribute("class")).toContain("settle-in");

    rerender(<SettledCheck settled={false} label="Not yet here" />);
    expect(mark(container)?.getAttribute("class")).not.toContain("settle-in");
  });
});
