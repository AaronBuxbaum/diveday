// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineConfirm } from "./InlineConfirm";

afterEach(() => {
  cleanup();
});

/** Renders inside a real <form> — InlineConfirm's confirm button is a real submit, guarded by this. */
function renderInForm(onSubmit: () => void) {
  render(
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
});
