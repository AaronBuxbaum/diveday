// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
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

const COPY = {
  savedNote: "Saved on this device for when there’s no signal.",
  remove: "Remove saved copy",
  removed: "Removed from this device until you next open this link.",
  removeFailed: "Could not remove the saved copy. Free up storage and try again online.",
};

describe("ReadyOfflineCopy", () => {
  it("draws nothing into the page for the server to render, and carries no date or token", () => {
    expect(renderToStaticMarkup(<ReadyOfflineCopy copy={COPY} />)).toBe("");
  });

  it("online, says nothing until a copy is kept, and asks the worker once", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy copy={COPY} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(keepReadyPageOnDevice).toHaveBeenCalledTimes(1);
  });

  /**
   * **The diver can take the copy off this device** (issue #2693): the copy is
   * kept silently on any browser that opens the link, a hotel PC or a shop
   * tablet among them. The control shows only once a copy is actually kept.
   */
  it("offers to remove the copy once one is kept, and says when it is gone", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy copy={COPY} />);
    const remove = await screen.findByRole("button", { name: COPY.remove });
    expect(screen.getByText(COPY.savedNote, { exact: false })).toBeTruthy();

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
    render(<ReadyOfflineCopy copy={COPY} />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: COPY.remove })).toBeNull();
  });

  it("does not say the copy was removed when storage cleanup fails", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.mocked(forgetReadyPageCopy).mockResolvedValueOnce(false);
    render(<ReadyOfflineCopy copy={COPY} />);
    const remove = await screen.findByRole("button", { name: COPY.remove });
    await act(async () => {
      fireEvent.click(remove);
    });
    expect(screen.getByRole("status")).toHaveTextContent(COPY.removeFailed);
    expect(screen.queryByText(COPY.removed)).toBeNull();
  });

  /**
   * **Offline, the copy cannot be removed** (domain review 2, blocking): at a
   * dock with no signal it is the diver's only copy, and nothing can keep it
   * again, so a wet-hand tap must not delete it.
   */
  it("offline, offers no way to remove the copy and asks the worker for nothing", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ReadyOfflineCopy copy={COPY} />);
    expect(screen.queryByRole("button", { name: COPY.remove })).toBeNull();
    expect(keepReadyPageOnDevice).not.toHaveBeenCalled();
  });

  it("takes the remove control away when the signal drops, and gives it back with signal", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy copy={COPY} />);
    await screen.findByRole("button", { name: COPY.remove });
    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.queryByRole("button", { name: COPY.remove })).toBeNull();
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByRole("button", { name: COPY.remove })).toBeTruthy();
  });
});
