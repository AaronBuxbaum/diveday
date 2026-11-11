// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverflowActions } from "./OverflowActions";

vi.mock("next/navigation", () => ({ usePathname: () => "/details" }));
let width = 700;
const observers = new Set<() => void>();
beforeEach(() => {
  width = 700;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => 100);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => 500);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.add(callback);
      }
      observe() {}
      disconnect() {
        observers.clear();
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  observers.clear();
});
const show = () =>
  render(
    <OverflowActions label="More" primary={<button type="button">Copy link</button>}>
      <a href="/public">Public page</a>
      <button type="button">Print</button>
    </OverflowActions>,
  );
const resize = (next: number) =>
  act(() => {
    width = next;
    for (const callback of observers) callback();
  });

describe("actions overflow only when the actual row does not fit", () => {
  it("shows every action without More when there is room, including the exact boundary", () => {
    show();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(screen.getByRole("link", { name: "Public page" })).toBeVisible();
    resize(600);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });
  it("folds only when needed, dismisses on Escape and outside press, and unfolds after resize", () => {
    width = 599;
    const { container } = show();
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Public page" })).toBeNull();
    fireEvent.click(more);
    expect(screen.getByRole("link", { name: "Public page" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(more).toHaveFocus();
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    fireEvent.pointerDown(document.body);
    expect(more).toHaveAttribute("aria-expanded", "false");
    resize(900);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(screen.getByRole("link", { name: "Public page" })).toBeVisible();
    expect(container.querySelectorAll('a[href="/public"]')).toHaveLength(1);
  });
});
