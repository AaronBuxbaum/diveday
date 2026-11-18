// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeviceCleanupWarning } from "./DeviceCleanupWarning";
import { markDeviceCleanupIncomplete } from "./device-cleanup-warning";

const state = vi.hoisted(() => ({ flag: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.flag) }));
afterEach(() => {
  cleanup();
  state.flag = "";
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

it("keeps a generic warning visible on a later landing in the same tab", async () => {
  markDeviceCleanupIncomplete();
  render(<DeviceCleanupWarning message="Cleanup may be incomplete" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Cleanup may be incomplete");
});

it("shows a warning when a cleanup failure is reported after the page mounts", async () => {
  render(<DeviceCleanupWarning message="Cleanup may be incomplete" />);
  expect(screen.queryByRole("alert")).toBeNull();
  act(() => markDeviceCleanupIncomplete());
  expect(await screen.findByRole("alert")).toHaveTextContent("Cleanup may be incomplete");
});

it("shows an in-page warning when recording the marker fails", async () => {
  render(<DeviceCleanupWarning message="Cleanup may be incomplete" />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("blocked");
  });
  act(() => markDeviceCleanupIncomplete());
  expect(await screen.findByRole("alert")).toHaveTextContent("Cleanup may be incomplete");
});

it("shows the generic warning only for an incomplete cleanup redirect", () => {
  state.flag = "device_cleanup=incomplete";
  render(<DeviceCleanupWarning message="Cleanup may be incomplete" />);
  expect(screen.getByRole("alert")).toHaveTextContent("Cleanup may be incomplete");
});

it("does not show a warning for unrelated query parameters", () => {
  state.flag = "device_cleanup=other";
  render(<DeviceCleanupWarning message="Cleanup may be incomplete" />);
  expect(screen.queryByRole("alert")).toBeNull();
});
