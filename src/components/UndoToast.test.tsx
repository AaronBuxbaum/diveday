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

  /**
   * The toast's end padding and Undo's own padding add up to its start
   * padding, so the word "Undo" ends as far from the toast's end as the
   * message starts from its start. Both sides were `px-4` with the button's
   * padding on top: 19px in at the start, 26px at the end (pixel-craft K-102).
   */
  it("ends as far inside the toast as the message starts", () => {
    render(<UndoToast {...PROPS} />);
    const toast = screen.getByRole("status");
    const undo = screen.getByRole("button", { name: "Undo" });
    const px = (element: HTMLElement, prefix: string) =>
      Number(
        [...element.classList]
          .map((token) => token.match(new RegExp(`^${prefix}-(\\d+(?:\\.\\d+)?)$`)))
          .find(Boolean)?.[1],
      ) * 4;

    expect(toast).not.toHaveClass("px-4");
    expect(px(toast, "pe") + px(undo, "px")).toBe(px(toast, "ps"));
  });

  /**
   * That end padding is 4px, and the outset ring reaches 5px past the button
   * (3px wide, 2px off): focused, Undo's ring ran over the toast's own border
   * at 1280 (pixel-craft K-102, regressed by the padding above). The ring is
   * drawn inside the button's box, which is 4px clear of the toast's edge.
   */
  it("rings Undo inside its own box, clear of the toast's edge", () => {
    render(<UndoToast {...PROPS} />);
    expect(screen.getByRole("button", { name: "Undo" })).toHaveClass(
      "focus-visible:focus-ring-inset",
    );
  });
});

describe("UndoToast auto-dismiss", () => {
  it("dismisses on its own after autoDismissMs when left alone", () => {
    vi.useFakeTimers();
    render(<UndoToast {...PROPS} autoDismissMs={12000} />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    // The auto-dismiss timer fires at the deadline...
    act(() => {
      vi.advanceTimersByTime(12000);
    });
    // ...then the exit animation's own timer unmounts it.
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("pauses the countdown on hover and does not dismiss while hovered past the original deadline", () => {
    vi.useFakeTimers();
    render(<UndoToast {...PROPS} autoDismissMs={12000} />);
    const toast = screen.getByRole("status");

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    act(() => {
      fireEvent.mouseOver(toast);
    });

    // Well past the original 12s deadline, but still hovered — must not dismiss.
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("resumes from the remaining time on mouseleave, not a fresh 12s", () => {
    vi.useFakeTimers();
    render(<UndoToast {...PROPS} autoDismissMs={12000} />);
    const toast = screen.getByRole("status");

    // Consume 10s of the 12s budget, leaving ~2s, then pause.
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    act(() => {
      fireEvent.mouseOver(toast);
    });
    // Wait well past the original 12s deadline while paused — must not dismiss.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Resume: only the ~2s that was left should be left, not a fresh 12s —
    // if it reset to the full duration this would still be visible here.
    act(() => {
      fireEvent.mouseOut(toast);
    });
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // A timer newly registered by an effect mid-advance is anchored to this
    // call's end time, not the instant it was registered — give it one more
    // tick to fire the exit-unmount timer it just scheduled.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("pauses on focus of a descendant in capture phase (the Undo button) and resumes on blur", () => {
    vi.useFakeTimers();
    render(<UndoToast {...PROPS} autoDismissMs={12000} />);
    const undoButton = screen.getByRole("button", { name: "Undo" });

    // Consume 11s of the 12s budget, leaving ~1s, then focus the button —
    // not the toast container itself — to prove the capture-phase pause
    // catches descendant focus too.
    act(() => {
      vi.advanceTimersByTime(11000);
    });
    act(() => {
      undoButton.focus();
    });

    // Well past the original 12s deadline, but still focused — must not dismiss.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Resume: only the ~1s that was left should be left.
    act(() => {
      undoButton.blur();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
