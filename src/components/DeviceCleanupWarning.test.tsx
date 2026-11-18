// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeviceCleanupWarning } from "./DeviceCleanupWarning";

afterEach(() => {
  cleanup();
  history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

it("shows a generic warning from the sign-out redirect even when storage is unavailable", async () => {
  history.replaceState({}, "", "/?deviceCleanup=incomplete");
  vi.stubGlobal("sessionStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
  });
  render(<DeviceCleanupWarning message="Cleanup could not finish." />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Cleanup could not finish.");
});

it("does not show the warning when neither signal is present", () => {
  sessionStorage.clear();
  render(<DeviceCleanupWarning message="Cleanup could not finish." />);
  expect(screen.queryByRole("alert")).toBeNull();
});
