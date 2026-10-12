// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keepReadyPageOnDevice } from "@/lib/ready-offline";
import { ReadyOfflineCopy } from "./ReadyOfflineCopy";

vi.mock("@/lib/ready-offline", () => ({ keepReadyPageOnDevice: vi.fn(async () => true) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(keepReadyPageOnDevice).mockClear();
});

const NOTE = "No signal: this is the copy your phone saved.";

describe("ReadyOfflineCopy", () => {
  it("online, says nothing and keeps the page on the phone", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy offlineNote={NOTE} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(keepReadyPageOnDevice).toHaveBeenCalledTimes(1);
  });

  it("offline, says it is the saved copy and asks the worker for nothing", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ReadyOfflineCopy offlineNote={NOTE} />);
    expect(screen.getByRole("status")).toHaveTextContent(NOTE);
    expect(keepReadyPageOnDevice).not.toHaveBeenCalled();
  });

  it("follows the connection as it drops", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ReadyOfflineCopy offlineNote={NOTE} />);
    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(NOTE);
  });
});
