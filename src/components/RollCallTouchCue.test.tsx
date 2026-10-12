// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { motionMs } from "@/lib/motion";
import { ROLL_CALL_TOUCH_CUE_MS, RollCallTouchCue } from "./RollCallTouchCue";
import { TOUCH_REFUSED_EVENT } from "./roll-call-touch-guard";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LINE = "Tap again with one finger.";

const refuse = () => {
  const control = document.createElement("button");
  document.body.append(control);
  control.dispatchEvent(new CustomEvent(TOUCH_REFUSED_EVENT, { bubbles: true }));
  control.remove();
};

/**
 * The words that go with a refused roll-call press (issue #2328): said in a
 * polite status line when the guard refuses a press, and nowhere otherwise.
 */
describe("the roll call's touch cue", () => {
  it("says nothing while no press was refused", () => {
    render(<RollCallTouchCue message={LINE} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says the line when a press is refused, then goes", () => {
    vi.useFakeTimers();
    render(<RollCallTouchCue message={LINE} />);
    act(refuse);
    expect(screen.getByRole("status")).toHaveTextContent(LINE);
    act(() => vi.advanceTimersByTime(ROLL_CALL_TOUCH_CUE_MS));
    act(() => vi.advanceTimersByTime(motionMs("base")));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lands again for a second refusal, for a whole cue", () => {
    vi.useFakeTimers();
    render(<RollCallTouchCue message={LINE} />);
    act(refuse);
    act(() => vi.advanceTimersByTime(ROLL_CALL_TOUCH_CUE_MS - 100));
    act(refuse);
    act(() => vi.advanceTimersByTime(ROLL_CALL_TOUCH_CUE_MS - 100));
    expect(screen.getByRole("status")).toHaveTextContent(LINE);
  });
});
