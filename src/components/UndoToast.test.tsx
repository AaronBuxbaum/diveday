// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UndoToast } from "./UndoToast";
import { buttonClass } from "./ui/button";

// React derives onMouseEnter/onMouseLeave from the bubbling native
// mouseover/mouseout events, not from the (non-bubbling) mouseenter/mouseleave
// events themselves — dispatching those directly is a well-known no-op with
// React's event system, so these tests go through fireEvent.mouseOver/mouseOut.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PROPS = {
  message: "Diver deleted",
  action: vi.fn(),
  fields: { id: "diver-1" },
  pendingLabel: "Undoing…",
  undoLabel: "Undo",
  dismissLabel: "Dismiss",
};

/**
 * **Undo is a real button.** It hand-rolled `min-h-9 … px-2 … hover:underline`:
 * a 52×36 target under the 44px floor, with no press and no pointer (pixel-craft
 * K-347). It is the `link` variant at `sm` now, and `busy` because it is a
 * `SubmitButton`, which disables itself while its own undo is in flight.
 */
describe("the Undo button", () => {
  it("is the shared link button at sm, a 44px target", () => {
    render(<UndoToast {...PROPS} />);
    const undo = screen.getByRole("button", { name: "Undo" });

    expect(undo.className).toBe(
      buttonClass({
        variant: "link",
        size: "sm",
        busy: true,
        className: "focus-visible:focus-ring-inset",
      }),
    );
    expect(undo).toHaveClass("min-h-11");
    expect(undo).not.toHaveClass("min-h-9");
  });

  it("keeps the Undo and Dismiss controls at 44px targets", () => {
    render(<UndoToast {...PROPS} />);
    const undo = screen.getByRole("button", { name: "Undo" });
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    expect(undo).toHaveClass("min-h-11");
    expect(dismiss).toHaveClass("min-h-11");
  });

  it("draws the Undo and Dismiss focus rings inside their targets", () => {
    render(<UndoToast {...PROPS} />);
    expect(screen.getByRole("button", { name: "Undo" })).toHaveClass(
      "focus-visible:focus-ring-inset",
    );
    expect(screen.getByRole("button", { name: "Dismiss" })).toHaveClass(
      "focus-visible:focus-ring-inset",
    );
  });
});

describe("UndoToast keeps its reversal available", () => {
  it("can stay with the record whose action it reverses", () => {
    render(<UndoToast {...PROPS} placement="inline" />);
    const toast = screen.getByRole("status");

    expect(toast).toHaveClass("grid", "w-full", "min-w-0");
    expect(toast.parentElement).not.toHaveClass("fixed");
    expect(toast).toContainElement(screen.getByRole("button", { name: "Undo" }));
    expect(toast).toContainElement(screen.getByRole("button", { name: "Dismiss" }));
  });

  it("stays visible after the transient confirmation interval", () => {
    vi.useFakeTimers();
    render(<UndoToast {...PROPS} />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("status")).toContainElement(
      screen.getByRole("button", { name: "Undo" }),
    );
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeVisible();
  });

  it("dismisses the acknowledgement and its action when asked", () => {
    render(<UndoToast {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the next undo target after the current one was dismissed", () => {
    const { rerender } = render(<UndoToast {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(<UndoToast {...PROPS} fields={{ id: "diver-2" }} />);
    expect(screen.getByRole("status")).toContainElement(
      screen.getByRole("button", { name: "Undo" }),
    );
  });
});
