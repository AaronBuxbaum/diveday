// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineConfirm } from "./InlineConfirm";

// A stand-in for Next's real router context: `usePathname()` is what
// InlineConfirm keys its disarm-on-revisit effect on (see the component's
// own doc comment). `setMockPathname` lets a test simulate a navigation
// event — including an Activity-preserved show/hide cycle, should
// `cacheComponents: true` be re-enabled (it re-fires effects the same way) —
// without a real Next.js router.
const { usePathname, setMockPathname } = vi.hoisted(() => {
  let current = "/shop/blue-mantis/trips/trip-1/guests";
  return {
    usePathname: vi.fn(() => current),
    setMockPathname: (next: string) => {
      current = next;
    },
  };
});
vi.mock("next/navigation", () => ({ usePathname }));

afterEach(() => {
  cleanup();
  setMockPathname("/shop/blue-mantis/trips/trip-1/guests");
});

/** Renders inside a real <form> — InlineConfirm's confirm button is a real submit, guarded by this. */
function renderInForm(onSubmit: () => void) {
  return render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <InlineConfirm
        message="Cancel your spot on Reef Dive? This can't be undone. You're still inside the free-cancellation window, so what you paid comes back to you."
        triggerLabel="Cancel my spot"
        confirmLabel="Yes, cancel my spot"
        cancelLabel="Never mind"
        pendingLabel="Cancelling…"
        triggerClassName="trigger"
        confirmClassName="confirm"
      />
    </form>,
  );
}

describe("InlineConfirm", () => {
  it("starts unarmed: only the trigger renders, and it never submits the form", async () => {
    const onSubmit = vi.fn();
    renderInForm(onSubmit);

    expect(screen.getByRole("button", { name: "Cancel my spot" })).toBeInTheDocument();
    expect(screen.queryByText(/free-cancellation window/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes, cancel my spot" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel my spot" }));
    // Arming is a local state flip, not a submit — the trigger is a
    // type="button", so clicking it alone must never post the form.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("arming reveals the message and a real confirm submit — nothing is sent until that second click", async () => {
    const onSubmit = vi.fn();
    renderInForm(onSubmit);

    await userEvent.click(screen.getByRole("button", { name: "Cancel my spot" }));

    expect(screen.getByText(/free-cancellation window/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel my spot" })).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Yes, cancel my spot" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("backing out with 'never mind' resets to unarmed and submits nothing", async () => {
    const onSubmit = vi.fn();
    renderInForm(onSubmit);

    await userEvent.click(screen.getByRole("button", { name: "Cancel my spot" }));
    await userEvent.click(screen.getByRole("button", { name: "Never mind" }));

    expect(screen.getByRole("button", { name: "Cancel my spot" })).toBeInTheDocument();
    expect(screen.queryByText(/free-cancellation window/)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disarms on a pathname change — an Activity-preserved show/hide cycle must never resurface it armed", async () => {
    const onSubmit = vi.fn();
    const { rerender } = renderInForm(onSubmit);

    await userEvent.click(screen.getByRole("button", { name: "Cancel my spot" }));
    expect(screen.getByText(/free-cancellation window/)).toBeInTheDocument();

    // Simulate a navigate-away-and-back: the pathname changes and this
    // instance's effects re-run (an Activity re-show, should cacheComponents
    // be re-enabled, behaves like a fresh mount for effects, even though
    // state survived).
    setMockPathname("/shop/blue-mantis/trips/trip-1/manifest");
    rerender(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <InlineConfirm
          message="Cancel your spot on Reef Dive? This can't be undone. You're still inside the free-cancellation window, so what you paid comes back to you."
          triggerLabel="Cancel my spot"
          confirmLabel="Yes, cancel my spot"
          cancelLabel="Never mind"
          pendingLabel="Cancelling…"
          triggerClassName="trigger"
          confirmClassName="confirm"
        />
      </form>,
    );

    expect(screen.getByRole("button", { name: "Cancel my spot" })).toBeInTheDocument();
    expect(screen.queryByText(/free-cancellation window/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes, cancel my spot" })).not.toBeInTheDocument();
  });
});

/** Renders inside a real <form> — the compact mode's confirm tap is a real submit, guarded by this. */
function renderCompactInForm(onSubmit: () => void) {
  render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <InlineConfirm
        triggerLabel="Sign out"
        confirmLabel="Sign out? Confirm"
        pendingLabel="Signing out…"
        triggerClassName="idle"
        confirmClassName="confirm"
        autoResetMs={4000}
      />
    </form>,
  );
}

describe("InlineConfirm (compact mode — no message)", () => {
  it("starts unarmed and the first tap only arms it, without submitting", async () => {
    const onSubmit = vi.fn();
    renderCompactInForm(onSubmit);

    const button = screen.getByRole("button", { name: "Sign out" });
    await userEvent.click(button);

    expect(screen.getByRole("button", { name: "Sign out? Confirm" })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a second tap while armed submits", async () => {
    const onSubmit = vi.fn();
    renderCompactInForm(onSubmit);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out? Confirm" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("Escape disarms back to idle without submitting", async () => {
    const onSubmit = vi.fn();
    renderCompactInForm(onSubmit);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("losing focus disarms back to idle", async () => {
    const onSubmit = vi.fn();
    renderCompactInForm(onSubmit);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.blur(screen.getByRole("button", { name: "Sign out? Confirm" }));

    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("auto-resets to idle after inactivity", () => {
    vi.useFakeTimers();
    try {
      const onSubmit = vi.fn();
      renderCompactInForm(onSubmit);

      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(screen.getByRole("button", { name: "Sign out? Confirm" })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
