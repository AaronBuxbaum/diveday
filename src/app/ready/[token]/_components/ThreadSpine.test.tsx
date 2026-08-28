// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
