// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UndoToast } from "./UndoToast";

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
