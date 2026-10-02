// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SendHold } from "./SendHold";

/**
 * A send you can take back (ADR 20260906-before-you-ask, decision 2), shown as
 * a standard undo affordance: "Sending…" and Undo where Send stood. No
 * countdown, no ring, no rolling digits. The hold itself is the server's and
 * is pinned in `src/lib/held-sends.test.ts` and `src/app/actions/held-sends.test.ts`.
 */

const COPY = { sendingNow: "Sending…", undo: "Undo" };
const TICKET = { id: "held-1", runAt: 0, holdMs: 8_000 };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
});

function renderHold(overrides: Partial<Parameters<typeof SendHold<string>>[0]> = {}) {
  const props = {
    hold: vi.fn(async () => TICKET),
    undo: vi.fn(async () => true),
    release: vi.fn(async () => ({ status: "done" as const, outcome: "sent" })),
    onOutcome: vi.fn(),
    copy: COPY,
    ...overrides,
  };
  render(
    <SendHold<string> {...props}>
      <button type="submit">Send</button>
    </SendHold>,
  );
  return props;
}

async function tapSend() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
}

describe("SendHold", () => {
  it("says Sending… with Undo, and no countdown", async () => {
    renderHold();
    await tapSend();
    const row = screen.getByRole("status");
    expect(row).toHaveTextContent("Sending…");
    expect(row.textContent).not.toMatch(/\d/);
    expect(row.querySelector("svg")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("releases the send once the hold has run, and hands back its outcome", async () => {
    const props = renderHold();
    await tapSend();
    expect(props.release).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICKET.holdMs);
    });
    expect(props.release).toHaveBeenCalledWith("held-1");
    expect(props.onOutcome).toHaveBeenCalledWith("sent");
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("takes the send back on Undo, and never releases it", async () => {
    const props = renderHold();
    await tapSend();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(props.undo).toHaveBeenCalledWith("held-1");
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICKET.holdMs);
    });
    expect(props.release).not.toHaveBeenCalled();
  });

  it("asks again on the next tick when the server says the hold has not drained", async () => {
    const release = vi
      .fn()
      .mockResolvedValueOnce({ status: "pending" as const })
      .mockResolvedValue({ status: "done" as const, outcome: "sent" });
    const props = renderHold({ release });
    await tapSend();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICKET.holdMs);
    });
    expect(release).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(release).toHaveBeenCalledTimes(2);
    expect(props.onOutcome).toHaveBeenCalledWith("sent");
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});
