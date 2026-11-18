// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./forget-device", () => ({
  deviceCleanupMayBeIncomplete: vi.fn(() => false),
  forgetThisDevice: vi.fn(async () => ({ status: "incomplete" })),
}));

import { ForgetThisDevice } from "./ForgetThisDevice";
import { deviceCleanupMayBeIncomplete, forgetThisDevice } from "./forget-device";

afterEach(cleanup);

it("warns on sign-in when device cleanup was incomplete", async () => {
  render(<ForgetThisDevice incompleteMessage="Cleanup could not finish." />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Cleanup could not finish.");
});

it("keeps a warning from an earlier cleanup attempt after navigation", async () => {
  vi.mocked(deviceCleanupMayBeIncomplete).mockReturnValueOnce(true);
  vi.mocked(forgetThisDevice).mockResolvedValueOnce({ status: "attempted" });
  render(<ForgetThisDevice incompleteMessage="Cleanup could not finish." />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Cleanup could not finish.");
});
