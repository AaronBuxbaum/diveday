// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readNoteDraft, writeNoteDraft } from "@/lib/roll-call-note-draft";
import { RollCallNote, type RollCallNoteCopy } from "./RollCallNote";

const BOOKING = "00000000-0000-4000-8000-000000000001";

const COPY: RollCallNoteCopy = {
  optionalNote: "Note",
  message: {
    saving: "Saving…",
    waiting: "Saved on this device — sends with this diver’s result.",
    saved: "Saved.",
    queued: "Saved on this device — sends when you’re back online.",
    error: "Couldn’t save — your note is still here. Try again.",
    idle: "Saves as you type.",
  },
  notePlaceholder: "Late to the boat, medical question, kit issue…",
};

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  setOnline(true);
});

function renderNote(props: Partial<Parameters<typeof RollCallNote>[0]> = {}) {
  const saveNote = props.saveNote ?? vi.fn(async () => ({ ok: true, saved: true }));
  render(
    <RollCallNote
      bookingId={BOOKING}
      checkpoint="departure"
      initialNote=""
      saveNote={saveNote}
      copy={COPY}
      {...props}
    />,
  );
  return { saveNote, input: screen.getByLabelText("Note") };
}

describe("RollCallNote", () => {
  it("autosaves to the roll-call record and clears the device draft on success", async () => {
    const { saveNote, input } = renderNote();

    await userEvent.type(input, "kit issue");
    await userEvent.tab(); // blur flushes immediately

    await waitFor(() => expect(saveNote).toHaveBeenCalledWith(BOOKING, "departure", "kit issue"));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    // A confirmed save leaves nothing pending on the device.
    expect(readNoteDraft(BOOKING, "departure")).toBeNull();
  });

  it("keeps the note on the device when offline and replays it on reconnect", async () => {
    const saveNote = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, saved: true });
    setOnline(false);
    render(
      <RollCallNote
        bookingId={BOOKING}
        checkpoint="departure"
        initialNote=""
        saveNote={saveNote}
        copy={COPY}
      />,
    );

    await userEvent.type(screen.getByLabelText("Note"), "late");
    await userEvent.tab();

    expect(await screen.findByText(/sends when you’re back online/)).toBeInTheDocument();
    // The note is held on the device, flagged as not yet synced.
    expect(readNoteDraft(BOOKING, "departure")).toEqual({ value: "late", pending: true });

    // Connection returns: the browser fires `online` and the draft replays.
    setOnline(true);
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(readNoteDraft(BOOKING, "departure")).toBeNull();
  });

  it("restores a pending draft left on the device from an earlier visit", async () => {
    writeNoteDraft(BOOKING, "departure", { value: "medical question", pending: true });
    const { saveNote, input } = renderNote();

    expect(input).toHaveValue("medical question");
    // Back online, the restored draft is pushed to the roll-call record.
    await waitFor(() =>
      expect(saveNote).toHaveBeenCalledWith(BOOKING, "departure", "medical question"),
    );
  });

  it("keeps the note on the device and asks to retry when a save fails online", async () => {
    // Online, but the server rejects: no `online` event will fire to auto-retry,
    // so the copy must not promise one — it asks staff to try again.
    const saveNote = vi.fn().mockRejectedValue(new Error("500"));
    const { input } = renderNote({ saveNote });

    await userEvent.type(input, "reg free-flow");
    await userEvent.tab();

    expect(await screen.findByText(/your note is still here\. Try again/)).toBeInTheDocument();
    // Held on the device and still pending, so a reload replays it.
    expect(readNoteDraft(BOOKING, "departure")).toEqual({
      value: "reg free-flow",
      pending: true,
    });
  });

  it("holds a note the row has no result to attach it to yet, and says so as a hold", async () => {
    // The ordinary state of an uncalled diver, not a failure: the server has
    // nowhere to put the note until a roll-call result exists. The draft stays
    // *pending* so the next roll-call submit carries it (RollCallButton's
    // `useUnsavedNote`), and the line must not read as an error.
    const saveNote = vi.fn(async () => ({ ok: true, saved: false }));
    const { input } = renderNote({ saveNote });

    await userEvent.type(input, "waiting on waiver");
    await userEvent.tab();

    expect(await screen.findByText(/sends with this diver’s result/)).toBeInTheDocument();
    expect(screen.queryByText(/Try again/)).not.toBeInTheDocument();
    expect(readNoteDraft(BOOKING, "departure")).toEqual({
      value: "waiting on waiver",
      pending: true,
    });
  });

  it("saves as you type on every row, with no rule for staff to learn", async () => {
    // There is no second mode any more. The field used to autosave only once a
    // result existed and otherwise stand there saying "Saves with this diver's
    // roll-call result." — one field behaving two ways for a reason nobody at
    // the rail can see. Typing always reaches the server.
    const { saveNote, input } = renderNote();

    await userEvent.type(input, "reg checked");
    await userEvent.tab();

    await waitFor(() => expect(saveNote).toHaveBeenCalledWith(BOOKING, "departure", "reg checked"));
  });

  it("keeps a newer keystroke when an older save lands after it", async () => {
    // Staff type faster than a round trip. If the in-flight save's success
    // clears the draft wholesale, the newer text is on neither the server nor
    // the device until its own debounce fires — and a "Mark boarded" tap in
    // that window posts no note at all (RollCallButton's `useUnsavedNote`
    // reads exactly this draft). Regression for the window.
    let release: (value: { ok: boolean; saved: boolean }) => void = () => {};
    const inFlight = new Promise<{ ok: boolean; saved: boolean }>((resolve) => {
      release = resolve;
    });
    const saveNote = vi.fn().mockReturnValueOnce(inFlight).mockResolvedValue({
      ok: true,
      saved: true,
    });
    const { input } = renderNote({ saveNote });

    await userEvent.type(input, "reg");
    await userEvent.tab(); // flushes "reg" — now in flight

    // The staffer keeps typing while that request is out.
    await userEvent.type(input, " free-flow");
    expect(readNoteDraft(BOOKING, "departure")).toEqual({
      value: "reg free-flow",
      pending: true,
    });

    // The older save lands. It must not take the newer text with it.
    release({ ok: true, saved: true });
    // Flush only the promise continuation that handles the result — never the
    // newer keystroke's 700ms debounce. Waiting for that debounce is what
    // makes this bug invisible: the draft *is* wiped, and then rewritten a
    // beat later, so an assertion that polls until it reappears passes
    // against the broken code. The gap between those two moments is the bug,
    // and a staffer's tap lands in it.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(readNoteDraft(BOOKING, "departure")).toEqual({
      value: "reg free-flow",
      pending: true,
    });
  });

  it("calls a refused action a fault, not a hold", async () => {
    // `{ ok: false }` is the action refusing outright — a value that failed its
    // schema, or a checkpoint it could not prove. Reading that as the ordinary
    // "no result to attach to yet" hold would tell a staffer their note is
    // safely waiting when nothing will ever pick it up.
    const saveNote = vi.fn(async () => ({ ok: false, saved: false }));
    const { input } = renderNote({ saveNote });

    await userEvent.type(input, "bad value");
    await userEvent.tab();

    expect(await screen.findByText(/your note is still here\. Try again/)).toBeInTheDocument();
    expect(screen.queryByText(/sends with this diver/)).not.toBeInTheDocument();
  });
});
