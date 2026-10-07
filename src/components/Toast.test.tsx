// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("says its message as a status, then leaves after its beat", async () => {
    vi.useFakeTimers();
    render(<Toast message="Link copied" durationMs={1000} />);
    expect(screen.getByRole("status")).toHaveTextContent("Link copied");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("status").className).toContain("toast-dismiss");

    await act(async () => {
      vi.runAllTimers();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not pause for a pointer resting on it: there is nothing to press", async () => {
    vi.useFakeTimers();
    render(<Toast message="Link copied" durationMs={1000} />);
    const status = screen.getByRole("status");
    status.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(status.className).toContain("toast-dismiss");
  });
});
