// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoreMenu } from "./MoreMenu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function panelLeftAt(left: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const x = this.hasAttribute("data-more-menu-panel") ? left : 0;
    return {
      top: 0,
      bottom: 0,
      height: 0,
      left: x,
      right: x + 224,
      width: 224,
      x,
      y: 0,
      toJSON: () => ({}),
    };
  });
}

function menu() {
  render(
    <MoreMenu label="More">
      <a href="/print">Print</a>
    </MoreMenu>,
  );
  return screen.getByRole("button", { name: "More" });
}

describe("MoreMenu", () => {
  it("opens on its trigger, first row focused, and closes on a second tap", async () => {
    const user = userEvent.setup();
    const trigger = menu();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Print" })).toHaveFocus();
    await user.click(trigger);
    expect(screen.queryByRole("link", { name: "Print" })).toBeNull();
  });

  it("hangs from the trigger's end edge while that keeps it on screen", async () => {
    panelLeftAt(40);
    const user = userEvent.setup();
    await user.click(menu());
    const panel = document.querySelector("[data-more-menu-panel]");
    expect(panel?.className).toContain("end-0");
    expect(panel?.className).not.toContain("start-0");
  });

  it("hangs from the start edge when the end edge would push it off the left (a phone header)", async () => {
    panelLeftAt(-120);
    const user = userEvent.setup();
    await user.click(menu());
    const panel = document.querySelector("[data-more-menu-panel]");
    expect(panel?.className).toContain("start-0");
  });
});
