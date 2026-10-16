// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isTyping,
  LIVE_REFRESH_INTERVAL_MS,
  LIVE_REFRESH_MIN_GAP_MS,
  LiveRefresh,
} from "./LiveRefresh";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("LiveRefresh", () => {
  it("re-reads the page once a minute while it is visible", () => {
    render(<LiveRefresh />);
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("re-reads when the window takes focus, but not twice in a breath", () => {
    render(<LiveRefresh />);
    act(() => vi.advanceTimersByTime(LIVE_REFRESH_MIN_GAP_MS + 1));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh in the middle of someone typing", () => {
    const input = document.createElement("input");
    document.body.append(input);
    render(<LiveRefresh />);
    input.focus();
    act(() => vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS));
    expect(refresh).not.toHaveBeenCalled();
    input.blur();
    act(() => vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("holds off for a few seconds after a tap, so a row does not move under a thumb", () => {
    render(<LiveRefresh holdAfterTapMs={5000} />);
    act(() => vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS - 1000));
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("costs nothing in a hidden tab", () => {
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<LiveRefresh />);
    act(() => vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
    state.mockRestore();
  });
});

describe("isTyping", () => {
  it("reads a field as typing and a button as not", () => {
    expect(isTyping(document.createElement("textarea"))).toBe(true);
    expect(isTyping(document.createElement("select"))).toBe(true);
    expect(isTyping(document.createElement("button"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
