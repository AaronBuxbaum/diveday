// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetReadyPageCopy, keepReadyPageOnDevice } from "@/lib/ready-offline";
import { ReadyOfflineCopy } from "./ReadyOfflineCopy";

vi.mock("@/lib/ready-offline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ready-offline")>()),
  keepReadyPageOnDevice: vi.fn(async () => true),
  forgetReadyPageCopy: vi.fn(async () => true),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(keepReadyPageOnDevice).mockClear();
  vi.mocked(forgetReadyPageCopy).mockClear();
});

const NOTE = "No signal: this is the copy your phone saved.";
const COPY = {
  offlineNote: NOTE,
  savedNote: "Saved on this device for when there’s no signal.",
  remove: "Remove saved copy",
  removed: "Removed from this device.",
};
const KEEP_UNTIL = 1_800_000_000_000;

describe("ReadyOfflineCopy", () => {
  it("online, says nothing and keeps the page on the phone", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy copy={COPY} keepUntil={KEEP_UNTIL} />);
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(keepReadyPageOnDevice).toHaveBeenCalledTimes(1);
  });

  it("offline, says it is the saved copy and asks the worker for nothing", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ReadyOfflineCopy copy={COPY} keepUntil={KEEP_UNTIL} />);
    expect(screen.getByRole("status")).toHaveTextContent(NOTE);
    expect(keepReadyPageOnDevice).not.toHaveBeenCalled();
  });

  it("follows the connection as it drops", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy copy={COPY} keepUntil={KEEP_UNTIL} />);
    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(NOTE);
  });

  /** Security review of layer 8, D2: the worker keeps the copy only until the date the page names. */
  it("dates the copy for the worker that keeps it", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy copy={COPY} keepUntil={KEEP_UNTIL} />);
    expect(document.querySelector('meta[name="diveday-ready-keep-until"]')).toHaveAttribute(
      "content",
      String(KEEP_UNTIL),
    );
  });

  /**
   * **The diver can take the copy off this device** (issue #2693): the page
   * is kept silently on any browser that opens the link, a hotel PC or a shop
   * tablet among them. The control shows only once a copy is actually kept.
   */
  it("offers to remove the copy once one is kept, and says when it is gone", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy copy={COPY} keepUntil={KEEP_UNTIL} />);
    const remove = await screen.findByRole("button", { name: COPY.remove });
    expect(screen.getByText(COPY.savedNote)).toBeTruthy();

    await act(async () => {
      fireEvent.click(remove);
    });
    expect(forgetReadyPageCopy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: COPY.remove })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(COPY.removed);
  });

  it("offers nothing to remove when nothing was kept", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.mocked(keepReadyPageOnDevice).mockResolvedValueOnce(false);
    render(<ReadyOfflineCopy copy={COPY} keepUntil={KEEP_UNTIL} />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: COPY.remove })).toBeNull();
  });

  it("offline, the copy on screen is the kept one, and can be removed", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ReadyOfflineCopy copy={COPY} keepUntil={KEEP_UNTIL} />);
    expect(screen.getByRole("button", { name: COPY.remove })).toBeTruthy();
  });
});
