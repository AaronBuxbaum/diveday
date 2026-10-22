// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopNotice } from "./ShopPageHeader";
import { Toast } from "./Toast";
import { FormStatus } from "./ui/form";

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

it("dismisses successful form confirmations through the shared toast", async () => {
  vi.useFakeTimers();
  render(<FormStatus tone="success">Saved</FormStatus>);
  expect(screen.getByRole("status").parentElement).toHaveClass("fixed");
  await act(async () => {
    vi.runAllTimers();
  });
  await act(async () => {
    vi.runAllTimers();
  });
  expect(screen.queryByRole("status")).toBeNull();
});

it("replays the same success copy when a new action result arrives", async () => {
  vi.useFakeTimers();
  const { rerender } = render(
    <FormStatus tone="success" occurrenceKey={1}>
      Saved
    </FormStatus>,
  );
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.queryByRole("status")).toBeNull();

  rerender(
    <FormStatus tone="success" occurrenceKey={2}>
      Saved
    </FormStatus>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
});

it("keeps a detailed success report and its link available after the toast interval", async () => {
  vi.useFakeTimers();
  render(
    <ShopNotice tone="success" persistent>
      <p>Imported 12 divers; 2 credential rows need review.</p>
      <a href="/shop/divers">Review divers</a>
    </ShopNotice>,
  );
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.getByRole("status")).toHaveTextContent("2 credential rows need review");
  expect(screen.getByRole("link", { name: "Review divers" })).toBeVisible();
});
