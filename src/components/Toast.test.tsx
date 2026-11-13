// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorToast, Toast } from "./Toast";
import { FormStatus } from "./ui/form";
import { ShopNotice } from "./ui/outcome";

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

describe("ErrorToast", () => {
  it("keeps expiry paused when keyboard focus moves from the toast to its recovery link", async () => {
    vi.useFakeTimers();
    render(
      <ErrorToast
        durationMs={1000}
        message={
          <>
            Could not save. <a href="/retry">Review</a>
          </>
        }
      />,
    );
    const alert = screen.getByRole("alert");
    const link = screen.getByRole("link", { name: "Review" });
    fireEvent.focus(alert);
    fireEvent.blur(alert, { relatedTarget: link });
    fireEvent.focus(link);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(alert).not.toHaveClass("toast-dismiss");
    expect(link).toBeVisible();
  });

  it("puts a text-only error in the keyboard tab order without moving focus on arrival", async () => {
    render(<ErrorToast message="Could not save" />);
    const alert = screen.getByRole("alert");
    expect(alert).not.toHaveFocus();
    await userEvent.tab();
    expect(alert).toHaveFocus();
  });

  it("keeps a keyboard-focused error paused when the pointer leaves, then resumes its remaining time", async () => {
    vi.useFakeTimers();
    render(<ErrorToast message="Could not save" durationMs={1000} />);
    const alert = screen.getByRole("alert");
    fireEvent.focus(alert);
    fireEvent.mouseEnter(alert);
    fireEvent.mouseLeave(alert);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(alert).toBeVisible();
    expect(alert).not.toHaveClass("toast-dismiss");
    fireEvent.blur(alert);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says an error as an alert, then leaves instead of staying on the page", async () => {
    vi.useFakeTimers();
    render(<ErrorToast message="Could not save" durationMs={1000} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      vi.runAllTimers();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is where a form refusal and a danger notice go", () => {
    render(
      <>
        <FormStatus tone="danger">Refused</FormStatus>
        <ShopNotice tone="danger">Failed</ShopNotice>
      </>,
    );
    expect(screen.getAllByRole("alert").map((node) => node.className)).toEqual(
      [expect.stringContaining("toast"), expect.stringContaining("toast")].map(() =>
        expect.stringContaining("rise-in"),
      ),
    );
  });
});
