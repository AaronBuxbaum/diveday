// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RowMenu } from "./RowMenu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

/** Puts the "⋯" at `triggerTop` in a 800px screen, with a 120px-tall list. */
function placeTrigger(triggerTop: number) {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-row-menu") ? rect(0, 120) : rect(triggerTop, 32);
  });
}

describe("RowMenu", () => {
  it("focuses the first available action rather than a hidden form field", async () => {
    render(
      <RowMenu label="More">
        <form>
          <input type="hidden" name="done" value="true" />
          <button type="button">Mark done</button>
        </form>
      </RowMenu>,
    );
    const trigger = screen.getByRole("button", { name: "More" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Mark done" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
  it("opens downward when the list fits below the ⋯", async () => {
    placeTrigger(200);
    render(<RowMenu label="More">{<button type="button">Mark done</button>}</RowMenu>);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    const panel = document.querySelector("[data-row-menu]");
    expect(panel).toHaveClass("top-full");
    expect(panel).not.toHaveClass("bottom-full");
  });

  it("opens upward when the list would run off the foot of the screen", async () => {
    placeTrigger(700);
    render(<RowMenu label="More">{<button type="button">Delete</button>}</RowMenu>);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    const panel = document.querySelector("[data-row-menu]");
    expect(panel).toHaveClass("bottom-full");
    expect(panel).not.toHaveClass("top-full");
  });

  it("keeps the phone tab bar's strip as off the screen", async () => {
    // 600 + 32 + 120 fits under 800, but not under 800 less a 64px tab bar.
    placeTrigger(600);
    document.documentElement.style.setProperty("--tabbar-h", "64px");
    try {
      render(<RowMenu label="More">{<button type="button">Delete</button>}</RowMenu>);
      await userEvent.click(screen.getByRole("button", { name: "More" }));
      expect(document.querySelector("[data-row-menu]")).toHaveClass("bottom-full");
    } finally {
      document.documentElement.style.removeProperty("--tabbar-h");
    }
  });

  it("repositions an open menu when the viewport changes to phone size", async () => {
    let screenHeight = 900;
    vi.spyOn(window, "innerHeight", "get").mockImplementation(() => screenHeight);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-row-menu") ? rect(0, 120) : rect(700, 32);
    });
    render(<RowMenu label="More">{<button type="button">Delete</button>}</RowMenu>);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    const panel = document.querySelector("[data-row-menu]");
    expect(panel).toHaveClass("top-full");

    screenHeight = 844;
    document.documentElement.style.setProperty("--tabbar-h", "64px");
    try {
      act(() => window.dispatchEvent(new Event("resize")));
      expect(panel).toHaveClass("bottom-full");
    } finally {
      document.documentElement.style.removeProperty("--tabbar-h");
    }
  });

  it("a second tap on the ⋯ closes the list", async () => {
    placeTrigger(200);
    render(<RowMenu label="More">{<button type="button">Mark done</button>}</RowMenu>);
    const trigger = screen.getByRole("button", { name: "More" });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("[data-row-menu]")).toBeNull();
  });
});

it("preserves an unfinished editor when keepMounted is requested", async () => {
  render(
    <RowMenu label="Actions" keepMounted>
      <input aria-label="Draft" defaultValue="" />
    </RowMenu>,
  );
  const trigger = screen.getByRole("button", { name: "Actions" });
  expect(screen.queryByRole("textbox", { name: "Draft" })).toBeNull();
  await userEvent.click(trigger);
  await userEvent.type(screen.getByRole("textbox", { name: "Draft" }), "Unsent response");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("textbox", { name: "Draft" })).toBeNull();
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("Unsent response");
});

it("repositions and bounds an editor that grows asynchronously near the phone bar", async () => {
  let resized = () => {};
  let height = 40;
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resized = () => callback([], this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-row-menu") ? rect(0, height) : rect(600, 32);
  });
  document.documentElement.style.setProperty("--tabbar-h", "64px");
  try {
    render(
      <RowMenu label="Actions" keepMounted>
        <textarea aria-label="Draft" />
      </RowMenu>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    const panel = document.querySelector("[data-row-menu]");
    expect(panel).toHaveClass("top-full");
    height = 1000;
    act(() => resized());
    expect(panel).toHaveClass("bottom-full", "overflow-y-auto");
    expect(panel).toHaveStyle({ maxHeight: "576px" });
  } finally {
    globalThis.ResizeObserver = previous;
    document.documentElement.style.removeProperty("--tabbar-h");
  }
});
