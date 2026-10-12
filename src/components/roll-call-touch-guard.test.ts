// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TOUCH_REFUSED_ATTRIBUTE,
  TOUCH_REFUSED_CUE_MS,
  TOUCH_REFUSED_EVENT,
  wasMultiTouch,
  watchRollCallTouches,
} from "./roll-call-touch-guard";

function touch(type: "pointerDown" | "pointerUp", pointerId: number) {
  fireEvent[type](document, { pointerId, pointerType: "touch" });
}

function surface(): { button: HTMLButtonElement; onClick: ReturnType<typeof vi.fn> } {
  const main = document.createElement("main");
  main.setAttribute("data-roll-call-surface", "");
  const button = document.createElement("button");
  const onClick = vi.fn();
  button.addEventListener("click", onClick);
  main.append(button);
  document.body.append(main);
  return { button, onClick };
}

afterEach(() => {
  vi.useRealTimers();
  touch("pointerUp", 1);
  touch("pointerUp", 2);
  document.body.innerHTML = "";
});

describe("the roll call's touch guard", () => {
  watchRollCallTouches();

  it("drops a click on a roll-call surface made under two contacts", () => {
    const { button, onClick } = surface();
    touch("pointerDown", 1);
    touch("pointerDown", 2);
    expect(wasMultiTouch()).toBe(true);
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  /**
   * **A refused press is never silent** (issue #2328). The control it landed
   * on carries the cue for a moment, and the surface hears about it so it can
   * say "Tap again with one finger". Nothing is submitted, then or later.
   */
  it("flags the refused control for its cue, tells the surface, and clears the flag", () => {
    vi.useFakeTimers();
    const { button, onClick } = surface();
    const label = document.createElement("span");
    button.append(label);
    const heard = vi.fn();
    document.addEventListener(TOUCH_REFUSED_EVENT, heard);
    touch("pointerDown", 1);
    touch("pointerDown", 2);
    label.click();
    expect(onClick).not.toHaveBeenCalled();
    expect(button.hasAttribute(TOUCH_REFUSED_ATTRIBUTE)).toBe(true);
    expect(heard).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(TOUCH_REFUSED_CUE_MS);
    expect(button.hasAttribute(TOUCH_REFUSED_ATTRIBUTE)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
    document.removeEventListener(TOUCH_REFUSED_EVENT, heard);
  });

  it("raises no cue for a press it lets through", () => {
    const { button } = surface();
    const heard = vi.fn();
    document.addEventListener(TOUCH_REFUSED_EVENT, heard);
    touch("pointerDown", 1);
    touch("pointerUp", 1);
    button.click();
    expect(button.hasAttribute(TOUCH_REFUSED_ATTRIBUTE)).toBe(false);
    expect(heard).not.toHaveBeenCalled();
    document.removeEventListener(TOUCH_REFUSED_EVENT, heard);
  });

  it("lets a single touch through", () => {
    const { button, onClick } = surface();
    touch("pointerDown", 1);
    touch("pointerUp", 1);
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("never touches a click outside a roll-call surface", () => {
    const button = document.createElement("button");
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    document.body.append(button);
    touch("pointerDown", 1);
    touch("pointerDown", 2);
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ignores mouse and pen pointers", () => {
    const { button, onClick } = surface();
    fireEvent.pointerDown(document, { pointerId: 7, pointerType: "mouse" });
    fireEvent.pointerDown(document, { pointerId: 8, pointerType: "pen" });
    expect(wasMultiTouch()).toBe(false);
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("lets a keyboard press through after a palm has lifted", () => {
    const { button, onClick } = surface();
    touch("pointerDown", 1);
    touch("pointerDown", 2);
    touch("pointerUp", 1);
    touch("pointerUp", 2);
    fireEvent.keyDown(document, { key: "Enter" });
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
