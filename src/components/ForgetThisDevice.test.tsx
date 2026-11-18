// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markDeviceCleanupIncomplete } from "./device-cleanup-warning";
import { ForgetThisDevice } from "./ForgetThisDevice";
import * as deviceCleanup from "./forget-device";
import { keptTypedKey } from "./KeepTypedOnRefusal";
import { recentsStorageKey } from "./search/palette-recents";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("ForgetThisDevice", () => {
  it("clears ⌘K's recents and every kept form when the sign-in page paints", () => {
    window.localStorage.setItem(recentsStorageKey("blue-mantis", "p-1"), "[]");
    window.sessionStorage.setItem(keptTypedKey("seat-party", "blue-mantis.p-1"), "{}");
    window.localStorage.setItem("diveday.theme", "dark");
    render(<ForgetThisDevice warning="Cleanup incomplete" />);
    expect(window.localStorage.getItem(recentsStorageKey("blue-mantis", "p-1"))).toBeNull();
    expect(window.sessionStorage.getItem(keptTypedKey("seat-party", "blue-mantis.p-1"))).toBeNull();
    expect(window.localStorage.getItem("diveday.theme")).toBe("dark");
  });

  it("warns on sign-in when offline sensitive cleanup is incomplete", async () => {
    vi.spyOn(deviceCleanup, "forgetThisDevice").mockResolvedValueOnce({
      offlineSensitiveCleanupReportedComplete: false,
    });
    render(<ForgetThisDevice warning="Cleanup incomplete" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Cleanup incomplete");
  });

  it("does not clear an earlier warning after a later reported success", async () => {
    markDeviceCleanupIncomplete();
    vi.spyOn(deviceCleanup, "forgetThisDevice").mockResolvedValueOnce({
      offlineSensitiveCleanupReportedComplete: true,
    });
    render(<ForgetThisDevice warning="Cleanup incomplete" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Cleanup incomplete");
  });

  it("shows a later cleanup failure after sign-in has mounted", async () => {
    vi.spyOn(deviceCleanup, "forgetThisDevice").mockResolvedValueOnce({
      offlineSensitiveCleanupReportedComplete: true,
    });
    render(<ForgetThisDevice warning="Cleanup incomplete" />);
    act(() => markDeviceCleanupIncomplete());
    expect(await screen.findByRole("alert")).toHaveTextContent("Cleanup incomplete");
  });
});
