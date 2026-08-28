// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettledCheck } from "./SettledCheck";

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

  it("draws a different shape, not only a different colour", () => {
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
