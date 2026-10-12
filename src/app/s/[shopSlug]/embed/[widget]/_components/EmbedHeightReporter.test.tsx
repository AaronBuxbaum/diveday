// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedHeightReporter } from "./EmbedHeightReporter";

/**
 * The frame's half of the height contract `public/embed.js` reads
 * (`src/lib/embed-loader.test.ts` pins the loader's half).
 */
const postMessage = vi.fn();
const observe = vi.fn();

beforeEach(() => {
  postMessage.mockReset();
  observe.mockReset();
  // Framed: the parent is the shop's page, not this window.
  vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage } as unknown as Window);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = observe;
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the embed's height report", () => {
  /**
   * An empty page inside a frame is still as tall as the frame (the root's
   * scroll height never drops below the viewport), so measuring could never
   * say "nothing here". The empty widget says it outright (#2317).
   */
  it("reports exactly 0 for a widget with nothing to show, and stops there", () => {
    render(<EmbedHeightReporter empty />);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "diveday:height", height: 0 }, "*");
    expect(observe).not.toHaveBeenCalled();
  });

  it("reports the page's own height and follows it otherwise", () => {
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(640);
    render(<EmbedHeightReporter />);
    expect(postMessage).toHaveBeenCalledWith({ type: "diveday:height", height: 640 }, "*");
    expect(observe).toHaveBeenCalledWith(document.documentElement);
  });
});
