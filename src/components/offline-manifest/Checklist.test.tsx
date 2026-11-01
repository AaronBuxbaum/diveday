// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLEAR_CONFIRM_MIN_GAP_MS, CLEAR_CONFIRM_TIMEOUT_MS } from "@/lib/pre-departure-check";
import { OfflineChecklist, OfflineSnags } from "./Checklist";
import { controls, savedCopy, view } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

describe("OfflineChecklist", () => {
  it("draws no checklist for a shop that keeps none", () => {
    const { container } = render(<OfflineChecklist view={view()} controls={controls()} />);
    expect(container.innerHTML).toBe("");
  });

  it("draws the boat's open snags as saved, with nothing to press", () => {
    const saved = view();
    saved.envelope.snapshot.snags = {
      heading: "Open on this boat",
      items: [
        {
          line: "Radio check: VHF crackles on 16",
          notedBy: "Noted by Sal Moretti, Wed, Oct 14, 5:16 AM EDT",
          stillThere: "Ana Ruiz found it still there, Wed, Oct 14, 1:05 PM EDT",
        },
      ],
    };
    const { getByRole, getByText, queryByRole } = render(<OfflineSnags view={saved} />);
    expect(getByRole("heading", { name: "Open on this boat" })).toBeTruthy();
    expect(getByText("Radio check: VHF crackles on 16")).toBeTruthy();
    expect(getByText(/Ana Ruiz found it still there/)).toBeTruthy();
    expect(queryByRole("button")).toBeNull();
  });

  it("draws nothing when the copy carries no snags", () => {
    const { container } = render(<OfflineSnags view={view()} />);
    expect(container.innerHTML).toBe("");
  });
});

/**
 * **Checking is one tap; clearing is two** (#2567), the same rule the live
 * checklist keeps since #2481: on the boat, a wet hand brushing the phone must
 * not quietly undo "Emergency oxygen kit aboard".
 */
describe("OfflineChecklist: clearing a checked item asks first", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const envelope = savedCopy();
    envelope.snapshot.checklist = {
      items: [
        {
          id: "oxygen",
          label: "Emergency oxygen kit aboard",
          check: {
            state: "checked",
            occurredAt: "2026-08-01T12:10:00.000Z",
            recordedByName: "Dana Divemaster",
            note: null,
          },
        },
        { id: "radio", label: "Radio check done" },
      ],
    };
    const found = offlineTripView(envelope, "departure");
    if (!found) throw new Error("the fixture carries a manifest");
    const tripControls = controls();
    render(<OfflineChecklist view={found} controls={tripControls} />);
    const oxygen = () => screen.getByRole("button", { name: /Emergency oxygen kit aboard/ });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    return { record: tripControls.recordChecklistCheck, oxygen, user };
  }
  /** The pause a deliberate second tap takes; a bounce never does. */
  const pause = (ms = CLEAR_CONFIRM_MIN_GAP_MS) => act(() => vi.advanceTimersByTimeAsync(ms));

  it("checks an unchecked item in one tap", async () => {
    const { record, user } = setup();
    await user.click(screen.getByRole("button", { name: /Radio check done/ }));
    expect(record).toHaveBeenCalledExactlyOnceWith("radio", "checked");
  });

  it("does not clear a checked item on one tap, and says what the next tap does", async () => {
    const { record, oxygen, user } = setup();
    await user.click(oxygen());
    await pause();
    expect(record).not.toHaveBeenCalled();
    expect(oxygen()).toHaveTextContent("Tap again to clear");
    // Announced, since a changed button name is not.
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toContain(
      "Tap again to clear",
    );
  });

  it("clears it on a second tap within the timeout", async () => {
    const { record, oxygen, user } = setup();
    await user.click(oxygen());
    await pause();
    await user.click(oxygen());
    expect(record).toHaveBeenCalledExactlyOnceWith("oxygen", "cleared");
  });

  it("ignores a bounced double tap: two taps 50ms apart only ask", async () => {
    const { record, oxygen } = setup();
    fireEvent.click(oxygen());
    await pause(50);
    fireEvent.click(oxygen());
    await pause();
    expect(record).not.toHaveBeenCalled();
    expect(oxygen()).toHaveTextContent("Tap again to clear");
  });

  it("lets the ask lapse after the timeout, so a single tap again only asks", async () => {
    const { record, oxygen } = setup();
    fireEvent.click(oxygen());
    await pause();
    expect(oxygen()).toHaveTextContent("Tap again to clear");
    await pause(CLEAR_CONFIRM_TIMEOUT_MS);
    expect(oxygen()).not.toHaveTextContent("Tap again to clear");
    fireEvent.click(oxygen());
    await pause();
    expect(record).not.toHaveBeenCalled();
    expect(oxygen()).toHaveTextContent("Tap again to clear");
  });

  it("stands down when the tap goes elsewhere, and on Escape", async () => {
    const { record, oxygen, user } = setup();
    await user.click(oxygen());
    await pause();
    fireEvent.blur(oxygen());
    expect(oxygen()).not.toHaveTextContent("Tap again to clear");
    await user.click(oxygen());
    await pause();
    fireEvent.keyDown(oxygen(), { key: "Escape" });
    expect(oxygen()).not.toHaveTextContent("Tap again to clear");
    expect(record).not.toHaveBeenCalled();
  });

  it("ignores a held Enter key, so one press cannot ask and then clear", async () => {
    const { record, oxygen } = setup();
    // A browser repeats keydown while Enter is held, and each repeat clicks a
    // focused button: the first asks, one past the gap would clear.
    expect(fireEvent.keyDown(oxygen(), { key: "Enter", repeat: true })).toBe(false);
    // The first press is the browser's to turn into a click.
    expect(fireEvent.keyDown(oxygen(), { key: "Enter" })).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });

  it("spends the ask when the local write settles", async () => {
    const envelope = savedCopy();
    envelope.snapshot.checklist = {
      items: [
        {
          id: "oxygen",
          label: "Emergency oxygen kit aboard",
          check: {
            state: "checked",
            occurredAt: "2026-08-01T12:10:00.000Z",
            recordedByName: "Dana Divemaster",
            note: null,
          },
        },
      ],
    };
    const found = offlineTripView(envelope, "departure");
    if (!found) throw new Error("the fixture carries a manifest");
    const tripControls = controls();
    const { rerender } = render(<OfflineChecklist view={found} controls={tripControls} />);
    const oxygen = screen.getByRole("button", { name: /Emergency oxygen kit aboard/ });

    fireEvent.click(oxygen);
    await pause();
    expect(oxygen).toHaveTextContent("Tap again to clear");
    rerender(
      <OfflineChecklist view={found} controls={{ ...tripControls, busyChecklistItem: "oxygen" }} />,
    );
    rerender(<OfflineChecklist view={found} controls={tripControls} />);
    expect(oxygen).not.toHaveTextContent("Tap again to clear");

    fireEvent.click(oxygen);
    await pause();
    expect(oxygen).toHaveTextContent("Tap again to clear");
    expect(tripControls.recordChecklistCheck).not.toHaveBeenCalled();
  });

  it("names two taps to a screen reader on a checked item", () => {
    const { oxygen } = setup();
    expect(oxygen()).toHaveAccessibleName(/press twice to clear/);
  });
});
