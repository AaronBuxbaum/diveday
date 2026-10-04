// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
