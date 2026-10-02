// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wasMultiTouch, watchRollCallTouches } from "./roll-call-touch-guard";

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
