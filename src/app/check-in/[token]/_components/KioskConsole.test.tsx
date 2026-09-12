// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KioskResult } from "../kiosk-types";
import { KioskConsole } from "./KioskConsole";

/**
 * **What the box holds, and for how long** — the half of this surface's privacy
 * that lives in the browser rather than in the action.
 *
 * The action's own promises (one sentence for every refusal, a floor under every
 * answer) are pinned in `../actions.test.ts`. What can only be seen here is the
 * glass: a lobby tablet stands unattended, and a scanned arrival code is a live
 * bearer credential for this morning's boat, so it must not be readable on the
 * screen a moment longer than the submit that carried it (`security-reviewer`,
 * 2026-09-12).
 */

/** The real action is a server action; what it answers is beside the point here. */
const answered: FormData[] = [];
let answer: (result: KioskResult) => void = () => {};
let pending: Promise<KioskResult> = Promise.resolve({ status: "idle" });

vi.mock("../actions", () => ({
  kioskCheckInAction: (_token: string, _previous: KioskResult, formData: FormData) => {
    answered.push(formData);
    return pending;
  },
}));

afterEach(() => {
  // Let a held action settle before the next test mounts its own console: an
  // in-flight `useActionState` outlives `cleanup()` otherwise, and the test
  // after it inherits the stall.
  answer({ status: "idle" });
  cleanup();
});

/** A real-shaped credential: `randomBytes(32).toString("base64url")` is 43 characters. */
const SCANNED = "Q1DgXcoTBt5hEeoo-TXPnDp0vPVj3Dm3dSFaIkm3Kzw";

const READY: KioskResult = {
  status: "ready",
  heading: "You’re set, Ana.",
  lines: ["Reef trip, 8:00 AM"],
};

const copy = { prompt: "Last name?", submit: "Check in", submitting: "Checking in" };

/** Renders the console with the action held open, and returns the box. */
function openConsole(): HTMLInputElement {
  answered.length = 0;
  pending = new Promise<KioskResult>((resolve) => {
    answer = resolve;
  });
  render(<KioskConsole token="a-display-link-token" copy={copy} />);
  return screen.getByLabelText(copy.prompt) as HTMLInputElement;
}

describe("KioskConsole — what stands on the glass", () => {
  it("empties the box the moment a scanned code is submitted, before the answer comes back", async () => {
    const user = userEvent.setup();
    const box = openConsole();

    await user.type(box, SCANNED);
    await user.click(screen.getByRole("button", { name: copy.submit }));

    // The action still got the whole code: the box is emptied after React has
    // built the FormData, never before it.
    await waitFor(() => expect(answered).toHaveLength(1));
    expect(answered[0]?.get("who")).toBe(SCANNED);
    // Nothing has answered yet, and the credential is already off the screen —
    // asserted flat rather than through `waitFor`, because "at the submit" is
    // the whole claim and a poll would also pass on a clear that came later.
    expect(screen.queryByRole("status")).toBeNull();
    expect(box).toHaveValue("");

    answer(READY);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(box).toHaveValue("");
  });

  it("leaves a typed surname in the box while the tablet thinks, and clears it with the answer", async () => {
    const user = userEvent.setup();
    const box = openConsole();

    await user.type(box, "Marquez");
    await user.click(screen.getByRole("button", { name: copy.submit }));

    // A surname is what the queue can already hear, so it stays put while the
    // diver waits — and the box must stay uncontrolled for React to empty it.
    await waitFor(() => expect(screen.getByRole("button", { name: copy.submitting })).toBeTruthy());
    expect(box).toHaveValue("Marquez");

    answer(READY);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(box).toHaveValue("");
  });
});
