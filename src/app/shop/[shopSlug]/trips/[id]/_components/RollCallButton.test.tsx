// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearNoteDraft, writeNoteDraft } from "@/lib/roll-call-note-draft";
import type { RollCallAction, RollCallButtonCopy, RollCallResult } from "./RollCallButton";
import { RollCallButton } from "./RollCallButton";

afterEach(cleanup);

function mockAction(result: RollCallResult) {
  return vi.fn<RollCallAction>(async () => result);
}

const DEFAULT_COPY: RollCallButtonCopy = {
  errorRefusal: "That didn’t save. Recheck your connection or tap again.",
  blockedMessage: "Diver is still blocked. Open Guests to resolve the blocker, then try again.",
};

function setup(action: RollCallAction, copy: RollCallButtonCopy = DEFAULT_COPY) {
  render(
    <RollCallButton
      action={action}
      subject={{ field: "bookingId", id: "00000000-0000-4000-8000-000000000001" }}
      status="boarded"
      label="Board"
      pendingLabel="Boarding…"
      className="btn"
      copy={copy}
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
    // `blockedMessage` is pre-rendered by the Server Component caller (see
    // manifest/page.tsx's `t.rich` call) — the test stands in for that here.
    setup(mockAction({ ok: false, reason: "not_ready" }), {
      ...DEFAULT_COPY,
      blockedMessage: (
        <>
          Diver is still blocked.{" "}
          <a href="/shop/blue-mantis/trips/trip-1/guests#booking-1">
            Open Guests to resolve the blocker
          </a>
          , then try again.
        </>
      ),
    });

    await userEvent.click(screen.getByRole("button", { name: "Board" }));

    expect(await screen.findByRole("link", { name: /open guests/i })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-1/guests#booking-1",
    );
  });

  it("keying by checkpoint (the caller's documented contract) drops a stale refusal on a checkpoint switch", async () => {
    // manifest/page.tsx's real fix: the checkpoint switcher reuses the same
    // route, so without a checkpoint-derived `key` this instance — and its
    // useActionState `result`, which has no external setter — would survive
    // a switch and misattribute a refusal to the wrong checkpoint. This
    // stands in for that caller by wrapping the same `key` pattern.
    function Harness({ checkpoint, action }: { checkpoint: string; action: RollCallAction }) {
      return (
        <RollCallButton
          key={checkpoint}
          action={action}
          subject={{ field: "bookingId", id: "00000000-0000-4000-8000-000000000001" }}
          status="boarded"
          label="Board"
          pendingLabel="Boarding…"
          className="btn"
          copy={DEFAULT_COPY}
        />
      );
    }

    const action = mockAction({ ok: false, reason: "not_ready" });
    const { rerender } = render(<Harness checkpoint="departure" action={action} />);

    await userEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/still blocked/i);

    // Switch checkpoints — same route, different key.
    rerender(<Harness checkpoint="after_dive_1" action={action} />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * **A note typed before anyone was called still lands.**
   *
   * A roll-call note lives on the roll-call event row, so before a diver has
   * been called there is no row to save it to. It used to ride the *not
   * boarded* submit alone, through a `form=` attribute on the note input —
   * which meant a staffer who typed "reg free-flow, swapped it" and then
   * tapped **Mark boarded** watched their note disappear. Both buttons carry
   * the still-unsaved draft now.
   */
  describe("an unsaved note draft", () => {
    const BOOKING = "00000000-0000-4000-8000-000000000001";

    afterEach(() => {
      clearNoteDraft(BOOKING, "departure");
      localStorage.clear();
    });

    it("rides whichever result the staffer records", async () => {
      writeNoteDraft(BOOKING, "departure", { value: "reg free-flow", pending: true });
      const action = mockAction({ ok: true });
      render(
        <RollCallButton
          action={action}
          subject={{ field: "bookingId", id: BOOKING }}
          status="boarded"
          label="Board"
          pendingLabel="Boarding…"
          className="btn"
          noteDraftFor={{ bookingId: BOOKING, checkpoint: "departure" }}
          copy={DEFAULT_COPY}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Board" }));
      expect(action.mock.calls[0]?.[1].get("note")).toBe("reg free-flow");
    });

    it("posts nothing when the server already holds the note", async () => {
      // An acknowledged draft is not pending. Posting it again as an empty or
      // stale value would silently overwrite what the autosave already stored.
      writeNoteDraft(BOOKING, "departure", { value: "already saved", pending: false });
      const action = mockAction({ ok: true });
      render(
        <RollCallButton
          action={action}
          subject={{ field: "bookingId", id: BOOKING }}
          status="boarded"
          label="Board"
          pendingLabel="Boarding…"
          className="btn"
          noteDraftFor={{ bookingId: BOOKING, checkpoint: "departure" }}
          copy={DEFAULT_COPY}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Board" }));
      expect(action.mock.calls[0]?.[1].has("note")).toBe(false);
    });
  });
});
