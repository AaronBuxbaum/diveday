// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExitAnimation } from "./useExitAnimation";

/**
 * No `renderHook` precedent in this codebase (see `UndoToast.test.tsx`) — a
 * tiny harness component is the established shape for testing a hook's
 * timing behavior here.
 */
function Overlay({ open, durationMs = 180 }: { open: boolean; durationMs?: number }) {
  const { mounted, closing } = useExitAnimation(open, durationMs);
  if (!mounted) return null;
  return <div role="status">{closing ? "closing" : "open"}</div>;
}

/**
 * Regression harness for the synchronous-entrance bug (see the test below):
 * an effect that focuses newly-mounted content the instant `open` becomes
 * true, the same shape the command palette's own autofocus takes.
 */
function EntranceProbe({ open }: { open: boolean }) {
  const { mounted } = useExitAnimation(open, 180);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // If `mounted` lagged `open` by a render, this ref would still be null
    // the instant this effect runs on the same `open` transition.
    if (open) ref.current?.focus();
  }, [open]);
  return mounted ? <input ref={ref} aria-label="probe" /> : null;
}

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mockReducedMotion(false);
});

describe("useExitAnimation", () => {
  it("renders nothing when it starts closed", () => {
    render(<Overlay open={false} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("mounts immediately on open, with no closing state", () => {
    render(<Overlay open={true} />);
    expect(screen.getByRole("status")).toHaveTextContent("open");
  });

  it("mounts synchronously — the same render, not one render later", () => {
    // Regression: the first version of this hook set `mounted` from a
    // `useEffect` reacting to `open`, which inserted a one-render gap before
    // the overlay actually existed. Anything that focuses content on `open`
    // in its own effect — the command palette's autofocus — ran in that gap
    // against an input that did not exist yet, which e2e caught and a plain
    // render() would not have (issue #832 review). This asserts the DOM node
    // itself is there, effects and all, immediately after the render that
    // flips `open` true — not after a subsequent `act()`/flush.
    render(<EntranceProbe open={true} />);
    expect(screen.getByLabelText("probe")).toHaveFocus();
  });

  it("stays mounted through the exit animation, then unmounts", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Overlay open={true} durationMs={180} />);
    expect(screen.getByRole("status")).toHaveTextContent("open");

    rerender(<Overlay open={false} durationMs={180} />);
    // Still mounted, now animating out — this is the whole point: React
    // used to unmount in the same frame the state changed.
    expect(screen.getByRole("status")).toHaveTextContent("closing");

    act(() => {
      vi.advanceTimersByTime(179);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("cancels a pending close and re-opens without a stray unmount", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Overlay open={true} durationMs={180} />);
    rerender(<Overlay open={false} durationMs={180} />);
    expect(screen.getByRole("status")).toHaveTextContent("closing");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender(<Overlay open={true} durationMs={180} />);
    expect(screen.getByRole("status")).toHaveTextContent("open");

    // The cancelled timer must never fire and unmount a now-open overlay.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("status")).toHaveTextContent("open");
  });

  it("never starts a close timer for an overlay that was never open", () => {
    vi.useFakeTimers();
    render(<Overlay open={false} durationMs={180} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("skips the animated hold under prefers-reduced-motion and unmounts immediately", () => {
    mockReducedMotion(true);
    vi.useFakeTimers();
    const { rerender } = render(<Overlay open={true} durationMs={180} />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(<Overlay open={false} durationMs={180} />);
    // No lingering "closing" frame, and no need to advance any timer — a
    // reduced-motion reader must not watch a closed overlay sit inert for
    // 180ms doing nothing (the failure mode this hook exists to own).
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
