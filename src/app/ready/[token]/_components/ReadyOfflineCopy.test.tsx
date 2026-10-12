// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keepReadyPageOnDevice } from "@/lib/ready-offline";
import { ReadyOfflineCopy } from "./ReadyOfflineCopy";

vi.mock("@/lib/ready-offline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ready-offline")>()),
  keepReadyPageOnDevice: vi.fn(async () => true),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(keepReadyPageOnDevice).mockClear();
});

const NOTE = "No signal: this is the copy your phone saved.";
const KEEP_UNTIL = 1_800_000_000_000;

describe("ReadyOfflineCopy", () => {
  it("online, says nothing and keeps the page on the phone", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy offlineNote={NOTE} keepUntil={KEEP_UNTIL} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(keepReadyPageOnDevice).toHaveBeenCalledTimes(1);
  });

  it("offline, says it is the saved copy and asks the worker for nothing", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ReadyOfflineCopy offlineNote={NOTE} keepUntil={KEEP_UNTIL} />);
    expect(screen.getByRole("status")).toHaveTextContent(NOTE);
    expect(keepReadyPageOnDevice).not.toHaveBeenCalled();
  });

  it("follows the connection as it drops", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy offlineNote={NOTE} keepUntil={KEEP_UNTIL} />);
    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(NOTE);
  });

  /** Security review of layer 8, D2: the worker keeps the copy only until the date the page names. */
  it("dates the copy for the worker that keeps it", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy offlineNote={NOTE} keepUntil={KEEP_UNTIL} />);
    expect(document.querySelector('meta[name="diveday-ready-keep-until"]')).toHaveAttribute(
      "content",
      String(KEEP_UNTIL),
    );
  });
});
