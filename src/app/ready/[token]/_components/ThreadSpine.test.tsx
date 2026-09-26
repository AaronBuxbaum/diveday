// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SETTLED_CHECK_TEXT_INSET } from "@/components/ui/settled-mark";
import {
  THREAD_STATUS_TEST_ID,
  ThreadSpine,
  type ThreadSpineStep,
  ThreadStatus,
} from "./ThreadSpine";

/**
 * The two rules ADR 20260827-the-divers-thread's decision 3 states about the
 * *page*, rather than about the steps: status is said **once**, and **at most
 * one step is open at rest**.
 *
 * Both were defects before the recomposition, not hypotheticals. The page
 * stated the booking's status four times in one screenful (an earned moment,
 * an emails line, a receipt panel and the checklist's own "almost there"
 * line), and it opened five inline forms at once.
 */

afterEach(cleanup);

function step(overrides: Partial<ThreadSpineStep> & Pick<ThreadSpineStep, "id">): ThreadSpineStep {
  return {
    state: "your_turn",
    current: false,
    title: overrides.id,
    stateWord: "Your turn",
    line: null,
    ...overrides,
  };
}

describe("ThreadStatus", () => {
  it("says the figure and what is next, in one element", () => {
    render(<ThreadStatus done={2} doneSuffix="of 4 done" trailing="Next: Gear and sizes" />);
    const statements = screen.getAllByTestId(THREAD_STATUS_TEST_ID);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.textContent).toBe("2of 4 doneNext: Gear and sizes");
  });

  it("settles into plain success ink, never coral", () => {
    // The thread spends its accent exactly three times — booked, the waiver's
    // completed state, welcome home (ADR 20260827-the-divers-thread, decision
    // 6, and the coral-budget table in
    // 20260827-clearwater-surface-language's decision 11). "You're all set" is
    // none of them: it used to fire a second `EarnedMoment` on this page.
    const { container } = render(
      <ThreadStatus done={4} doneSuffix="of 4 done" trailing="You’re all set" settled />,
    );
    expect(screen.getByText("You’re all set")).toBeVisible();
    expect(container.querySelector("[class*='accent']")).toBeNull();
    expect(container.querySelector(".rise-in")).toBeNull();
  });
});

describe("ThreadSpine", () => {
  it("opens exactly one step at rest, and it is the current one", () => {
    const { container } = render(
      <ThreadSpine
        steps={[
          step({ id: "sign", state: "done", stateWord: null, line: "Signed and on file." }),
          step({
            id: "pay",
            current: true,
            body: <button type="button">Pay for this trip</button>,
          }),
          step({ id: "gear", body: <input aria-label="BCD" /> }),
          step({ id: "dayof", body: <input aria-label="When did you last dive?" /> }),
        ]}
      />,
    );
    expect(container.querySelectorAll("details")).toHaveLength(3);
    const open = container.querySelectorAll("details[open]");
    expect(open).toHaveLength(1);
    expect(open[0]?.id).toBe("step-pay");
  });

  it("groups every openable step into one native accordion", () => {
    // `<details name>` is what keeps "at most one open" true after a tap, with
    // no listener and no state to lose — so a step opened out of order closes
    // whichever was open.
    const { container } = render(
      <ThreadSpine
        steps={[
          step({ id: "gear", current: true, body: <input aria-label="BCD" /> }),
          step({ id: "dayof", body: <input aria-label="When did you last dive?" /> }),
        ]}
      />,
    );
    const names = [...container.querySelectorAll("details")].map((d) => d.getAttribute("name"));
    expect(new Set(names)).toEqual(new Set(["thread-step"]));
  });

  it("renders a settled step as a line that never opens", () => {
    const { container } = render(
      <ThreadSpine
        steps={[
          step({ id: "sign", state: "done", stateWord: null, line: "Signed and on file." }),
          step({
            id: "pay",
            state: "with_shop",
            stateWord: "With the shop",
            line: "Your shop is confirming your readiness.",
          }),
        ]}
      />,
    );
    expect(container.querySelectorAll("details")).toHaveLength(0);
    // The fact a settled step states is on the line itself, not hidden behind
    // a disclosure — that is the whole of what a collapsed step says.
    expect(screen.getByText("Signed and on file.")).toBeVisible();
    expect(screen.getByText("Your shop is confirming your readiness.")).toBeVisible();
  });

  it("gives every state a word, never colour alone", () => {
    render(
      <ThreadSpine
        steps={[
          step({
            id: "gear",
            current: true,
            title: "Gear and sizes",
            body: <input aria-label="BCD" />,
          }),
          step({
            id: "dayof",
            title: "Day-of details",
            state: "with_shop",
            stateWord: "With the shop",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Your turn")).toBeVisible();
    expect(screen.getByText("With the shop")).toBeVisible();
    // …and the settle mark carries its own label, which is the component's own
    // required prop rather than a convention.
    expect(screen.getByText("Gear and sizes")).toBeVisible();
    expect(screen.getByText("Day-of details")).toBeVisible();
  });

  it("opens a step's body clear of the focus ring round its head", () => {
    // The global ring reaches 5px outside the `<summary>`, and the body is a
    // later sibling, so a body flush under the head painted "Sign your
    // waiver" over the ring's bottom arm (K-161: summary y 589–660, button
    // from 661). The head keeps its own even padding — a closed step is the
    // same row as a settled one, centred between its hairlines — and the body
    // opens 8px down, past the ring's reach.
    const { container } = render(
      <ThreadSpine
        steps={[
          step({
            id: "sign",
            current: true,
            line: "Sign your waiver.",
            body: <button type="button">Sign your waiver</button>,
          }),
          step({ id: "pay", state: "done", stateWord: null, line: "Paid." }),
        ]}
      />,
    );
    const summary = container.querySelector("summary");
    const settledRow = container.querySelector("li[data-thread-step='pay'] > div");
    expect(summary?.className).toContain(settledRow?.className ?? "missing");
    expect(summary?.nextElementSibling?.classList.contains("pt-2")).toBe(true);
  });

  it("keeps an open step's fact 12px over its form, and its name where the closed row puts it", () => {
    // The body's 8px clear of the ring came on top of the head's even `py-3`,
    // so on every open step (the current one on every /ready view) the fact
    // stood 20px over the first control where it had stood 12 (K-161 review).
    // An open head lends those 8px from its own bottom instead, and 8px of its
    // floor with them, so a name with no fact under it does not drop 4px as
    // its step opens. A closed head is the settled row, untouched.
    const RING_REACH = 5; // globals.css: a 3px outline, 2px off its box
    const NAME_LINE = 24; // the name's text-base line
    const OPEN = "group-open/step:";
    const { container } = render(
      <ThreadSpine
        steps={[
          step({
            id: "sign",
            current: true,
            line: "Sign your waiver.",
            body: <button type="button">Sign your waiver</button>,
          }),
        ]}
      />,
    );
    const summary = container.querySelector("summary");
    const body = summary?.nextElementSibling;
    if (!summary || !body) throw new Error("no open step");
    expect(summary.closest("details")?.classList.contains("group/step")).toBe(true);
    /** The px the first of these spacing utilities sets on `el`, in 4px steps. */
    const px = (el: Element, ...utilities: string[]) => {
      const tokens = el.className.split(/\s+/);
      for (const utility of utilities) {
        const token = tokens.find((t) => t.startsWith(`${utility}-`));
        if (token) return Number(token.slice(utility.length + 1)) * 4;
      }
      throw new Error(`none of ${utilities.join(", ")} in "${el.className}"`);
    };
    const top = px(summary, "pt", "py");
    const closedBottom = px(summary, "pb", "py");
    const openBottom = px(summary, `${OPEN}pb`, "pb", "py");
    const closedFloor = px(summary, "min-h");
    const openFloor = px(summary, `${OPEN}min-h`, "min-h");
    const bodyTop = px(body, "pt");

    expect(openBottom + bodyTop).toBe(closedBottom);
    expect(bodyTop).toBeGreaterThan(RING_REACH);
    const nameTop = (floor: number, bottom: number) => top + (floor - top - bottom - NAME_LINE) / 2;
    expect(nameTop(openFloor, openBottom)).toBe(nameTop(closedFloor, closedBottom));
  });

  it("hangs a step's fact under its name, on the name's own edge", () => {
    // The name starts after the settle mark and its gap; the fact under it
    // was indented 32px against the name's 28, 4px right of it on every step
    // (K-169). The inset now comes from the mark's own geometry.
    render(
      <ThreadSpine
        steps={[step({ id: "sign", state: "done", stateWord: null, line: "Signed and on file." })]}
      />,
    );
    expect(screen.getByText("Signed and on file.")).toHaveClass(SETTLED_CHECK_TEXT_INSET);
  });

  it("keeps a settled step openable when its form is still worth re-opening", () => {
    // Gear and Day-of are the two: a diver changes a fin size the night
    // before. The closed summary *is* the check line the ADR asks for.
    const { container } = render(
      <ThreadSpine
        steps={[
          step({
            id: "gear",
            state: "done",
            stateWord: null,
            line: "Your sizes are with the crew.",
            body: <input aria-label="BCD" />,
          }),
        ]}
      />,
    );
    expect(container.querySelectorAll("details")).toHaveLength(1);
    expect(container.querySelectorAll("details[open]")).toHaveLength(0);
    expect(screen.getByText("Your sizes are with the crew.")).toBeVisible();
  });
});
