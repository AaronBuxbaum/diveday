// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QueueRowButton } from "./QueueRowButton";

afterEach(cleanup);

describe("QueueRowButton", () => {
  /**
   * A checked-in row trails nothing at rest: its group is already called
   * "Checked in", so the row stopped repeating it (`CounterQueueRow`). The
   * slot's `span.shrink-0` rendered anyway, empty, and the pixel probe found
   * it taking the row's 16px gap on every checked-in row of check-in-checked,
   * so the diver's details wrapped 16px short of the row's end.
   */
  it("leaves no empty slot on a row that trails nothing", () => {
    render(
      <form>
        <QueueRowButton
          ariaLabel="Undo check-in for Marie Tharp"
          trailing={null}
          pendingTrailing={<span>Undoing…</span>}
        >
          <span>Marie Tharp</span>
        </QueueRowButton>
      </form>,
    );

    const button = screen.getByRole("button", { name: "Undo check-in for Marie Tharp" });
    expect(button.children).toHaveLength(1);
    expect(button.querySelectorAll(":scope > :empty")).toHaveLength(0);
  });

  it("keeps the slot at the row's end for a row that trails a word", () => {
    render(
      <form>
        <QueueRowButton
          ariaLabel="Check in Marie Tharp"
          trailing={<span>Check in</span>}
          pendingTrailing={<span>Checking in…</span>}
        >
          <span>Marie Tharp</span>
        </QueueRowButton>
      </form>,
    );

    const button = screen.getByRole("button", { name: "Check in Marie Tharp" });
    expect(button.children).toHaveLength(2);
    expect(button.lastElementChild).toHaveClass("shrink-0");
    expect(button.lastElementChild).toHaveAttribute("aria-hidden", "true");
    expect(button.lastElementChild).toHaveTextContent("Check in");
  });
});
