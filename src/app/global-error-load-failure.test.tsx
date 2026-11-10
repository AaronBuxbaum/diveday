// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const load = vi.hoisted(() => vi.fn());
vi.mock("./_fonts/fonts", () => ({ fontVariables: "" }));
vi.mock("./sentry-client", () => {
  load();
  throw new Error("telemetry unavailable");
});

import GlobalError from "./global-error";

it("keeps the root fallback usable if telemetry cannot load", async () => {
  const reset = vi.fn();
  render(<GlobalError error={new Error("crash")} reset={reset} />);
  await waitFor(() => expect(load).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(reset).toHaveBeenCalledOnce();
});
