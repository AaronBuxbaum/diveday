// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicShopHeaderHeight } from "./PublicShopHeaderHeight";

const observers: Observer[] = [];
class Observer implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(private callback: ResizeObserverCallback) {
    observers.push(this);
  }
  resize() {
    act(() => this.callback([], this));
  }
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", Observer);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, 0, 390, Number(this.getAttribute("data-height")));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--public-chrome-h");
});
const measured = () => document.documentElement.style.getPropertyValue("--public-chrome-h");
function header(height: number) {
  return (
    <header data-height={height}>
      <PublicShopHeaderHeight />
    </header>
  );
}

describe("the public header's measured inset", () => {
  it("measures its own header, rounds clearance upward and can grow and shrink", () => {
    const view = render(header(88.25));
    const bar = view.container.querySelector("header");
    expect(measured()).toBe("89px");
    expect(bar).toHaveAttribute("data-chrome-measured", "true");
    expect(observers[0].observe).toHaveBeenCalledWith(bar);
    view.rerender(header(264.5));
    observers[0].resize();
    expect(measured()).toBe("265px");
    view.rerender(header(56));
    observers[0].resize();
    expect(measured()).toBe("56px");
  });

  it("does not rewrite an unchanged rounded height during observer callbacks", () => {
    const write = vi.spyOn(document.documentElement.style, "setProperty");
    const view = render(header(88.1));
    view.rerender(header(88.2));
    observers[0].resize();
    observers[0].resize();
    expect(write.mock.calls.filter(([name]) => name === "--public-chrome-h")).toHaveLength(1);
  });

  it("disconnects and removes its global measurement when leaving the public layout", () => {
    const view = render(header(176));
    view.unmount();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(measured()).toBe("");
  });

  it("does not let an older header's resize or cleanup clear a newer header", () => {
    const old = render(header(88));
    const current = render(header(176));
    observers[0].resize();
    expect(measured()).toBe("176px");
    old.unmount();
    expect(measured()).toBe("176px");
    current.unmount();
    expect(measured()).toBe("");
  });

  it("does not let an older hidden header claim a newer header's measurement", () => {
    const old = render(header(0));
    const current = render(header(176));
    old.rerender(header(88));
    observers[0].resize();
    expect(measured()).toBe("176px");
    old.unmount();
    current.unmount();
  });

  it("removes a hidden header's measurement and measures it again when visible", () => {
    const view = render(header(176));
    view.rerender(header(0));
    observers[0].resize();
    expect(measured()).toBe("");
    expect(view.container.querySelector("header")).not.toHaveAttribute("data-chrome-measured");
    view.rerender(header(88));
    observers[0].resize();
    expect(measured()).toBe("88px");
  });

  it("takes one initial measurement and cleans up without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const view = render(header(88));
    expect(measured()).toBe("88px");
    view.unmount();
    expect(measured()).toBe("");
  });
});
