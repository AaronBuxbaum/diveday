// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readNoteDraft, writeNoteDraft } from "@/lib/roll-call-note-draft";
import { RollCallNote } from "./RollCallNote";

const BOOKING = "00000000-0000-4000-8000-000000000001";

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
      formId="not-boarded-x"
      initialNote=""
      canAutoSave
      saveNote={saveNote}
      {...props}
    />,
  );
  return { saveNote, input: screen.getByLabelText("Optional note") };
}

describe("RollCallNote", () => {
  it("autosaves to the roll-call record and clears the device draft on success", async () => {
    const { saveNote, input } = renderNote();

    await userEvent.type(input, "kit issue");
    await userEvent.tab(); // blur flushes immediately

    await waitFor(() => expect(saveNote).toHaveBeenCalledWith(BOOKING, "departure", "kit issue"));
    expect(await screen.findByText("Saved to this roll-call record.")).toBeInTheDocument();
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
        formId="not-boarded-x"
        initialNote=""
        canAutoSave
        saveNote={saveNote}
      />,
    );

    await userEvent.type(screen.getByLabelText("Optional note"), "late");
    await userEvent.tab();

    expect(await screen.findByText(/will sync when you’re back online/)).toBeInTheDocument();
    // The note is held on the device, flagged as not yet synced.
    expect(readNoteDraft(BOOKING, "departure")).toEqual({ value: "late", pending: true });

    // Connection returns: the browser fires `online` and the draft replays.
    setOnline(true);
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Saved to this roll-call record.")).toBeInTheDocument();
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

    expect(await screen.findByText(/still saved on this device\. Try again/)).toBeInTheDocument();
    // Held on the device and still pending, so a reload replays it.
    expect(readNoteDraft(BOOKING, "departure")).toEqual({
      value: "reg free-flow",
      pending: true,
    });
  });

  it("stops replaying a note the record has nothing to annotate (clear/undo race)", async () => {
    const saveNote = vi.fn(async () => ({ ok: true, saved: false }));
    const { input } = renderNote({ saveNote });

    await userEvent.type(input, "orphan note");
    await userEvent.tab();

    await screen.findByText(/still saved on this device\. Try again/);
    // Pending is cleared so the reconnect listener won't loop on an unsavable note.
    expect(readNoteDraft(BOOKING, "departure")).toEqual({
      value: "orphan note",
      pending: false,
    });
    saveNote.mockClear();
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("persists a draft locally before any status exists, without hitting the server", async () => {
    const { saveNote, input } = renderNote({ canAutoSave: false });

    await userEvent.type(input, "waiting on waiver");

    // Nothing to annotate yet: the note rides the not-boarded form on submit,
    // but is still held on the device so a reload can't lose it.
    expect(saveNote).not.toHaveBeenCalled();
    expect(readNoteDraft(BOOKING, "departure")).toEqual({
      value: "waiting on waiver",
      pending: true,
    });
  });
});
