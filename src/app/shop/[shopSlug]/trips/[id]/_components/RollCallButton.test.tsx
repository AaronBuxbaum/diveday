// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RollCallAction, RollCallResult } from "./RollCallButton";
import { RollCallButton } from "./RollCallButton";

afterEach(cleanup);

function mockAction(result: RollCallResult) {
  return vi.fn<RollCallAction>(async () => result);
}

function setup(action: RollCallAction, guestsHref?: string) {
  render(
    <RollCallButton
      action={action}
      bookingId="00000000-0000-4000-8000-000000000001"
      status="boarded"
      label="Board"
      pendingLabel="Boarding…"
      className="btn"
      guestsHref={guestsHref}
    />,
  );
}

describe("RollCallButton", () => {
  it("rolls back with the worded reason and vibrates with warning pattern when the server refuses, keeping the label", async () => {
    const vibrateMock = vi.fn();
    vi.stubGlobal("navigator", { vibrate: vibrateMock });

    const action = mockAction({ ok: false, reason: "not_ready" });
    setup(action);

    await userEvent.click(screen.getByRole("button", { name: "Board" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/still blocked/i);
    // The safety line: a refused board never shows a confirmed state.
    expect(screen.getByRole("button")).toHaveTextContent("Board");
    expect(action).toHaveBeenCalledOnce();
    // The booking id and target status ride along in the posted form.
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("bookingId")).toBe("00000000-0000-4000-8000-000000000001");
    expect(formData?.get("status")).toBe("boarded");

    expect(vibrateMock).toHaveBeenCalledWith([40, 40, 40]);

    vi.unstubAllGlobals();
  });

  it("shows no rollback message and triggers haptic vibration when the board succeeds", async () => {
    const vibrateMock = vi.fn();
    vi.stubGlobal("navigator", { vibrate: vibrateMock });

    const action = mockAction({ ok: true });
    setup(action);

    await userEvent.click(screen.getByRole("button", { name: "Board" }));
    // Give the action microtask a chance to resolve.
    await screen.findByRole("button", { name: "Board" });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(vibrateMock).toHaveBeenCalledWith(10);

    vi.unstubAllGlobals();
  });

  it("links a readiness refusal to the Guests control", async () => {
    setup(
      mockAction({ ok: false, reason: "not_ready" }),
      "/shop/blue-mantis/trips/trip-1/guests#booking-1",
    );

    await userEvent.click(screen.getByRole("button", { name: "Board" }));

    expect(await screen.findByRole("link", { name: /open guests/i })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-1/guests#booking-1",
    );
  });
});
